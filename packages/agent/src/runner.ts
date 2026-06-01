/**
 * @locai/agent — AgentRunner class.
 *
 * Connects to the LocAI server via SSE and drives the agentic loop,
 * emitting typed events for tool calls, results, tokens, and errors.
 */

import { EventEmitter } from "node:events";
import type { ToolDefinition } from "@locai/core/tools/registry";
import type { AgentRunnerConfig, RunOptions, RunResult, ToolCallRecord } from "./types.ts";
import type { AgentEvent } from "./events.ts";

/** Names of built-in coding tools provided by the server. */
export const BUILTIN_TOOL_NAMES = new Set([
  "file_read",
  "file_write",
  "shell_exec",
  "grep_search",
  "git_status",
  "git_diff",
  "web_fetch",
]);

/**
 * AgentRunner — programmatic interface for running agentic tasks.
 *
 * Emits typed AgentEvent events during execution and returns a RunResult
 * when the task completes.
 */
export class AgentRunner extends EventEmitter {
  private serverUrl: string;
  private customTools: ToolDefinition[] = [];
  private maxIterations: number;

  constructor(config: AgentRunnerConfig = {}) {
    super();
    this.serverUrl = config.serverUrl ?? "http://localhost:8080";
    this.maxIterations = config.maxIterations ?? 10;
    if (config.tools) {
      for (const tool of config.tools) this.registerTool(tool);
    }
  }

  /**
   * Register a custom tool. Throws if name conflicts with built-in or existing custom tool.
   */
  registerTool(definition: ToolDefinition): void {
    if (!definition.parameters || typeof definition.parameters !== "object") {
      throw new Error(
        `Tool "${definition.name}": parameters must be a valid JSON Schema object`,
      );
    }
    if (this.customTools.some((t) => t.name === definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }
    if (BUILTIN_TOOL_NAMES.has(definition.name)) {
      throw new Error(
        `Tool "${definition.name}" conflicts with a built-in tool`,
      );
    }
    this.customTools.push(definition);
  }

  /**
   * Run an agentic task. Connects to the LocAI server via SSE and emits events.
   */
  async run(task: string, options?: RunOptions): Promise<RunResult> {
    const signal = options?.signal;
    const toolNames = [
      ...BUILTIN_TOOL_NAMES,
      ...this.customTools.map((t) => t.name),
    ];

    const response = await fetch(`${this.serverUrl}/locai/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        tools: options?.tools ?? toolNames,
        maxIterations: options?.maxIterations ?? this.maxIterations,
        systemPrompt: options?.systemPrompt,
        projectRoot: options?.projectRoot,
        allowDangerousTools: options?.allowDangerousTools,
        approvalMode: options?.interactiveApprovals ? "interactive" : undefined,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Agent API ${response.status}: ${response.statusText}`);
    }

    return this.consumeStream(
      response.body,
      signal,
      response.headers.get("x-locai-task-id") ?? undefined,
    );
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<RunResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalAnswer = "";
    let iterations = 0;
    const toolCalls = new Map<string, ToolCallRecord>();
    let completionTokens = 0;

    const stopRemoteTask = () => {
      if (!taskId) return;
      fetch(`${this.serverUrl}/locai/agent/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      }).catch(() => {
        // Best-effort cancellation; local reader cancellation still proceeds.
      });
    };

    const onAbort = () => {
      stopRemoteTask();
      reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const processFrame = (frame: string) => {
      const lines = frame.split(/\r?\n/);
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      const rawData = dataLines.join("\n");
      const data = rawData ? JSON.parse(rawData) : {};

      if (eventName === "task_started") {
        return;
      }

      if (eventName === "tool_call") {
        const event = {
          type: "tool_call" as const,
          id: String(data.id ?? ""),
          name: String(data.name ?? ""),
          arguments: (data.arguments ?? {}) as Record<string, unknown>,
        };
        iterations++;
        toolCalls.set(event.id, {
          id: event.id,
          name: event.name,
          arguments: event.arguments,
          result: undefined,
        });
        this.emitEvent(event);
        return;
      }

      if (eventName === "tool_result") {
        const id = String(data.id ?? "");
        const existing = toolCalls.get(id);
        const result = data.results ?? data.result;
        if (existing) {
          existing.result = result;
        } else {
          toolCalls.set(id, {
            id,
            name: String(data.name ?? ""),
            arguments: {},
            result,
          });
        }
        this.emitEvent({
          type: "tool_result",
          id,
          name: String(data.name ?? existing?.name ?? ""),
          result,
        });
        return;
      }

      if (eventName === "approval_required") {
        this.emitEvent({
          type: "approval_required",
          taskId: String(data.taskId ?? taskId ?? ""),
          actionId: String(data.actionId ?? ""),
          toolName: String(data.toolName ?? ""),
          args: (data.args ?? {}) as Record<string, unknown>,
          summary: String(data.summary ?? ""),
          targetPath: typeof data.targetPath === "string" ? data.targetPath : undefined,
          diff: typeof data.diff === "string" ? data.diff : undefined,
        });
        return;
      }

      if (eventName === "token") {
        const content = String(data.content ?? "");
        const stop = Boolean(data.stop);
        if (!stop && content) {
          finalAnswer += content;
          completionTokens += Math.max(1, Math.ceil(content.length / 4));
        }
        this.emitEvent({ type: "token", content, stop });
        return;
      }

      if (eventName === "thinking") {
        this.emitEvent({
          type: "thinking",
          content: String(data.content ?? ""),
        });
        return;
      }

      if (eventName === "error") {
        this.emitEvent({
          type: "error",
          message: String(data.message ?? "Agent error"),
          recoverable: Boolean(data.recoverable),
        });
        return;
      }

      if (eventName === "done") {
        if (typeof data.finalAnswer === "string" && !finalAnswer) {
          finalAnswer = data.finalAnswer;
        }
        if (typeof data.iterations === "number") {
          iterations = data.iterations;
        }
        this.emitEvent({
          type: "done",
          finalAnswer,
          iterations,
          tokenCount: completionTokens,
        });
      }
    };

    try {
      while (true) {
        if (signal?.aborted) throw new Error("Agent run aborted");
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          if (frame) processFrame(frame);
          boundary = buffer.indexOf("\n\n");
        }
      }

      const tail = buffer.trim();
      if (tail) processFrame(tail);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return {
      finalAnswer,
      toolCallHistory: Array.from(toolCalls.values()),
      iterations,
      tokenCount: {
        prompt: 0,
        completion: completionTokens,
        total: completionTokens,
      },
    };
  }

  /** Emit a typed AgentEvent. */
  protected emitEvent(event: AgentEvent): void {
    this.emit(event.type, event);
  }

  async approve(taskId: string, actionId: string, opts: { always?: boolean } = {}): Promise<void> {
    await this.sendApproval(taskId, actionId, { approved: true, always: opts.always === true });
  }

  async deny(taskId: string, actionId: string): Promise<void> {
    await this.sendApproval(taskId, actionId, { approved: false });
  }

  private async sendApproval(
    taskId: string,
    actionId: string,
    decision: { approved: boolean; always?: boolean },
  ): Promise<void> {
    const response = await fetch(`${this.serverUrl}/locai/agent/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, actionId, ...decision }),
    });
    if (!response.ok) {
      throw new Error(`Approval API ${response.status}: ${response.statusText}`);
    }
  }
}
