/**
 * OpenAI-compatible HTTP server.
 *
 * This is the ecosystem unlock: any tool that speaks the OpenAI API (LangChain,
 * Open WebUI, IDE plugins, SDKs) works against LocAI unchanged, fully offline.
 *
 * Implements the subset the MVP needs:
 *   GET  /v1/models
 *   POST /v1/chat/completions   (stream + non-stream)
 *   GET  /health                (+ /locai/plan for our auto-plan transparency)
 *   GET  /locai/device          (device profile)
 *   GET  /locai/models          (model hub status)
 *   POST /locai/models/download (start a model download)
 *   DELETE /locai/models/:id/:quant (evict a model)
 *
 * Pure node:http — zero dependencies, runs everywhere Node runs.
 */

import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LocAI } from "../runtime/locai.ts";
import { profileDevice } from "../profiler/index.ts";
import { buildDownloadPlan } from "../planner/strategy.ts";
import type { ChatMessage } from "../engine/chat-template.ts";
import { ToolRegistry } from "../tools/registry.ts";
import type { OpenAITool, ToolDefinition } from "../tools/registry.ts";
import { makeWebSearchTool } from "../tools/web-search.ts";
import { makeCodingTools } from "../tools/coding.ts";
import {
  runAgenticLoop,
  type ChatMessage as AgenticChatMessage,
  type ModelResponse,
} from "./agentic.ts";
import { parseModelToolResponse, toEngineMessages } from "./tool-calling.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
  ai: LocAI;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "X-LocAI-Task-Id",
};

interface AgentTaskState {
  id: string;
  abortController: AbortController;
  startedAt: number;
  pendingApprovals: Map<string, (decision: ApprovalDecision) => void>;
  alwaysApprovedTools: Set<string>;
}

const activeAgentTasks = new Map<string, AgentTaskState>();

interface ApprovalDecision {
  approved: boolean;
  always?: boolean;
}

function send(res: http.ServerResponse, code: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", ...CORS_HEADERS });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function writeSse(res: http.ServerResponse, event: string, data?: unknown) {
  res.write(`event: ${event}\n`);
  if (data !== undefined) {
    res.write(`data: ${JSON.stringify(data)}\n`);
  }
  res.write("\n");
}

function truncateText(value: string, max = 8_000): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + `\n...[truncated ${value.length - max} chars]`;
}

function resolveProjectPath(projectRoot: string, input: unknown): string {
  const root = path.resolve(projectRoot);
  const requested = String(input ?? ".");
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${requested}`);
  }
  return resolved;
}

async function buildApprovalPreview(
  projectRoot: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ summary: string; targetPath?: string; diff?: string }> {
  if (toolName === "shell_exec") {
    return {
      summary: `Run shell command: ${String(args.command ?? "")}`,
    };
  }

  if (toolName === "file_write") {
    const fs = await import("node:fs/promises");
    const target = resolveProjectPath(projectRoot, args.path);
    const relative = path.relative(projectRoot, target);
    const next = String(args.content ?? "");
    let previous = "";
    try {
      previous = await fs.readFile(target, "utf8");
    } catch {
      previous = "";
    }

    const diff = [
      `--- ${relative || "."}`,
      `+++ ${relative || "."}`,
      "@@",
      ...previous.split("\n").slice(0, 200).map((line) => `-${line}`),
      ...next.split("\n").slice(0, 200).map((line) => `+${line}`),
    ].join("\n");

    return {
      summary: `Write ${relative || "."}`,
      targetPath: relative,
      diff: truncateText(diff),
    };
  }

  return { summary: `Approve ${toolName}` };
}

function registerCodingToolsWithApproval(opts: {
  registry: ToolRegistry;
  projectRoot: string;
  task: AgentTaskState;
  res: http.ServerResponse;
  allowDangerousTools: boolean;
  interactiveApprovals: boolean;
}): ToolDefinition[] {
  const safeTools = makeCodingTools({
    projectRoot: opts.projectRoot,
    allowDangerousTools: false,
  });
  const dangerousTools = makeCodingTools({
    projectRoot: opts.projectRoot,
    allowDangerousTools: true,
  });
  const dangerousByName = new Map(dangerousTools.map((tool) => [tool.name, tool]));
  const registered: ToolDefinition[] = [];

  for (const tool of safeTools) {
    const isDangerous = tool.name === "file_write" || tool.name === "shell_exec";
    let registeredTool = tool;

    if (isDangerous && opts.interactiveApprovals) {
      const executable = dangerousByName.get(tool.name) ?? tool;
      registeredTool = {
        ...tool,
        async execute(args) {
          if (opts.task.alwaysApprovedTools.has(tool.name)) {
            return executable.execute(args);
          }

          const actionId = randomUUID();
          const preview = await buildApprovalPreview(opts.projectRoot, tool.name, args);
          const decision = await new Promise<ApprovalDecision>((resolve) => {
            opts.task.pendingApprovals.set(actionId, resolve);
            writeSse(opts.res, "approval_required", {
              taskId: opts.task.id,
              actionId,
              toolName: tool.name,
              args,
              ...preview,
            });
          });

          opts.task.pendingApprovals.delete(actionId);
          if (decision.always) opts.task.alwaysApprovedTools.add(tool.name);
          if (!decision.approved) {
            return JSON.stringify({
              error: "permission_denied",
              tool: tool.name,
              message: "User denied this action.",
            });
          }

          return executable.execute(args);
        },
      };
    } else if (isDangerous && opts.allowDangerousTools) {
      registeredTool = dangerousByName.get(tool.name) ?? tool;
    }

    opts.registry.register(registeredTool);
    registered.push(registeredTool);
  }

  return registered;
}

async function callLocalModel(
  ai: LocAI,
  messages: AgenticChatMessage[],
  tools: OpenAITool[],
  opts: {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ModelResponse> {
  if (opts.signal?.aborted) throw new Error("agent task aborted");

  const chatMessages = tools.length > 0
    ? toEngineMessages(messages, tools, opts.systemPrompt)
    : messages
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role as ChatMessage["role"],
        content: m.content ?? "",
      }));

  let content = "";
  for await (const token of ai.chat(chatMessages, {
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  })) {
    if (opts.signal?.aborted) throw new Error("agent task aborted");
    content += token;
  }

  return tools.length > 0
    ? parseModelToolResponse(content, tools)
    : { content, tool_calls: undefined };
}

export async function serve(opts: ServeOptions): Promise<http.Server> {
  const { ai } = opts;
  const port = opts.port ?? 8080;
  const host = opts.host ?? "127.0.0.1";
  const modelId = ai.runPlan?.model.id ?? "unknown";
  const hub = ai.modelHub;
  const device = ai.device;

  // Initialize tool registry with WebSearchTool at server startup
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(makeWebSearchTool());

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      // Handle OPTIONS preflight for all paths
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok" });
      }

      // Transparency endpoint — surfaces the auto-plan + rationale.
      if (req.method === "GET" && url.pathname === "/locai/plan") {
        if (!ai.runPlan) {
          return send(res, 200, { device: device.cpu.brand, strategy: ai.strategyPlan.strategy });
        }
        return send(res, 200, {
          device: device.cpu.brand,
          model: ai.runPlan.model.displayName,
          quant: ai.runPlan.quant.id,
          backend: ai.runPlan.backend,
          predicted: ai.runPlan.predicted,
          rationale: ai.runPlan.rationale,
        });
      }

      // Device profile endpoint
      if (req.method === "GET" && url.pathname === "/locai/device") {
        return send(res, 200, profileDevice());
      }

      // Model hub status endpoint
      if (req.method === "GET" && url.pathname === "/locai/models") {
        const statuses = hub.status(device);
        return send(res, 200, statuses);
      }

      // Model download endpoint
      if (req.method === "POST" && url.pathname === "/locai/models/download") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { modelId?: string; quantId?: string };
        const { modelId: reqModelId, quantId: reqQuantId } = body;

        if (!reqModelId || !reqQuantId) {
          return send(res, 400, { error: { message: "modelId and quantId are required", type: "invalid_request_error" } });
        }

        // Find the model in the hub's catalog via status
        const statuses = hub.status(device);
        const match = statuses.find((s) => s.model.id === reqModelId && s.quant.id === reqQuantId);

        if (!match) {
          // Check if modelId exists at all
          const modelExists = statuses.some((s) => s.model.id === reqModelId);
          if (!modelExists) {
            return send(res, 404, { error: { message: `model '${reqModelId}' not found`, type: "not_found" } });
          }
          return send(res, 404, { error: { message: `quant '${reqQuantId}' not found for model '${reqModelId}'`, type: "not_found" } });
        }

        const downloadPlan = buildDownloadPlan(match.model, match.quant, device);
        hub.download(match.model, match.quant, downloadPlan);

        return send(res, 200, { status: "started" });
      }

      // Model eviction endpoint: DELETE /locai/models/:modelId/:quantId
      if (req.method === "DELETE" && url.pathname.startsWith("/locai/models/")) {
        const parts = url.pathname.slice("/locai/models/".length).split("/");
        if (parts.length === 2 && parts[0] && parts[1]) {
          const [reqModelId, reqQuantId] = parts;

          const statuses = hub.status(device);
          const match = statuses.find((s) => s.model.id === reqModelId && s.quant.id === reqQuantId);

          if (!match) {
            const modelExists = statuses.some((s) => s.model.id === reqModelId);
            if (!modelExists) {
              return send(res, 404, { error: { message: `model '${reqModelId}' not found`, type: "not_found" } });
            }
            return send(res, 404, { error: { message: `quant '${reqQuantId}' not found for model '${reqModelId}'`, type: "not_found" } });
          }

          hub.evict(match.model, match.quant);
          return send(res, 200, { status: "deleted" });
        }
      }

      if (req.method === "POST" && url.pathname === "/locai/agent/stop") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { taskId?: string };
        if (!body.taskId) {
          return send(res, 400, { error: { message: "taskId is required", type: "invalid_request_error" } });
        }

        const task = activeAgentTasks.get(body.taskId);
        if (!task) {
          return send(res, 404, { error: { message: `agent task '${body.taskId}' not found`, type: "not_found" } });
        }

        task.abortController.abort();
        activeAgentTasks.delete(body.taskId);
        return send(res, 200, { status: "stopped", taskId: body.taskId });
      }

      if (req.method === "POST" && url.pathname === "/locai/agent/approve") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          taskId?: string;
          actionId?: string;
          approved?: boolean;
          always?: boolean;
        };
        if (!body.taskId || !body.actionId) {
          return send(res, 400, { error: { message: "taskId and actionId are required", type: "invalid_request_error" } });
        }

        const task = activeAgentTasks.get(body.taskId);
        const resolve = task?.pendingApprovals.get(body.actionId);
        if (!task || !resolve) {
          return send(res, 404, { error: { message: `approval '${body.actionId}' not found`, type: "not_found" } });
        }

        resolve({ approved: body.approved === true || body.always === true, always: body.always === true });
        return send(res, 200, {
          status: body.approved === true || body.always === true ? "approved" : "denied",
          taskId: body.taskId,
          actionId: body.actionId,
        });
      }

      if (req.method === "POST" && url.pathname === "/locai/agent/run") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          task?: string;
          tools?: string[];
          projectRoot?: string;
          maxIterations?: number;
          max_tokens?: number;
          temperature?: number;
          systemPrompt?: string;
          autoApprove?: boolean;
          approvalMode?: "read-only" | "interactive" | "allow-dangerous";
          allowDangerousTools?: boolean;
        };

        if (!body.task || !body.task.trim()) {
          return send(res, 400, { error: { message: "task is required", type: "invalid_request_error" } });
        }

        const taskId = randomUUID();
        const abortController = new AbortController();
        activeAgentTasks.set(taskId, {
          id: taskId,
          abortController,
          startedAt: Date.now(),
          pendingApprovals: new Map(),
          alwaysApprovedTools: new Set(),
        });
        const task = activeAgentTasks.get(taskId)!;

        const projectRoot = path.resolve(body.projectRoot ?? process.cwd());
        const allowDangerousTools =
          body.allowDangerousTools === true ||
          body.autoApprove === true ||
          body.approvalMode === "allow-dangerous";
        const interactiveApprovals = body.approvalMode === "interactive" && !allowDangerousTools;

        const registry = new ToolRegistry();
        registry.register(makeWebSearchTool());
        registerCodingToolsWithApproval({
          registry,
          projectRoot,
          task,
          res,
          allowDangerousTools,
          interactiveApprovals,
        });

        const requestedNames = body.tools?.length
          ? body.tools
          : registry.list();
        const requestedTools = requestedNames
          .map((name) => registry.get(name))
          .filter((tool) => tool !== null);

        const systemPrompt = [
          body.systemPrompt,
          `Project root: ${projectRoot}`,
          allowDangerousTools
            ? "Dangerous tools are explicitly enabled for this trusted local run."
            : "Dangerous tools are disabled. Read/search first and propose edits instead of writing files or running shell commands.",
        ].filter(Boolean).join("\n\n");

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "X-LocAI-Task-Id": taskId,
          ...CORS_HEADERS,
        });

        res.on("close", () => {
          abortController.abort();
          for (const resolve of task.pendingApprovals.values()) {
            resolve({ approved: false });
          }
          activeAgentTasks.delete(taskId);
        });

        writeSse(res, "task_started", {
          taskId,
          projectRoot,
          tools: requestedTools.map((tool) => tool.name),
          dangerousToolsEnabled: allowDangerousTools,
          interactiveApprovals,
        });

        const started = Date.now();
        let finalAnswer = "";
        let toolCalls = 0;

        try {
          const callModel = async (
            agenticMessages: AgenticChatMessage[],
            openAITools: OpenAITool[],
          ): Promise<ModelResponse> => callLocalModel(ai, agenticMessages, openAITools, {
            maxTokens: body.max_tokens,
            temperature: body.temperature,
            systemPrompt,
            signal: abortController.signal,
          });

          const loop = runAgenticLoop(
            [{ role: "user", content: body.task }],
            requestedTools,
            registry,
            callModel,
            { maxIterations: body.maxIterations },
          );

          for await (const event of loop) {
            if (abortController.signal.aborted) break;

            if (event.event === "token") {
              const tokenData = event.data as { content: string; stop: boolean };
              if (!tokenData.stop) finalAnswer += tokenData.content;
            } else if (event.event === "tool_call") {
              toolCalls++;
            }

            if (event.event === "done") {
              writeSse(res, "done", {
                taskId,
                finalAnswer,
                iterations: toolCalls,
                elapsedMs: Date.now() - started,
              });
            } else {
              writeSse(res, event.event, event.data);
            }
          }
        } catch (error) {
          writeSse(res, "error", {
            taskId,
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
          });
          writeSse(res, "done", {
            taskId,
            finalAnswer,
            iterations: toolCalls,
            elapsedMs: Date.now() - started,
          });
        } finally {
          for (const resolve of task.pendingApprovals.values()) {
            resolve({ approved: false });
          }
          activeAgentTasks.delete(taskId);
          return res.end();
        }
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return send(res, 200, {
          object: "list",
          data: [{ id: modelId, object: "model", owned_by: "locai", created: 0 }],
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const raw = await readBody(req);
        const reqJson = JSON.parse(raw || "{}") as {
          messages: ChatMessage[];
          stream?: boolean;
          max_tokens?: number;
          temperature?: number;
          tools?: Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
        };
        const messages = reqJson.messages ?? [];

        const id = "chatcmpl-" + Math.random().toString(36).slice(2);
        const created = Math.floor(Date.now() / 1000);

        // If request contains tools array, route through the agentic loop
        if (reqJson.tools && reqJson.tools.length > 0) {
          // Resolve tool definitions from the registry based on the request's tools
          const requestedTools = reqJson.tools
            .map((t) => toolRegistry.get(t.function.name))
            .filter((t) => t !== null);

          const callModel = async (
            agenticMessages: AgenticChatMessage[],
            openAITools: OpenAITool[]
          ): Promise<ModelResponse> => {
            return callLocalModel(ai, agenticMessages, openAITools, {
              maxTokens: reqJson.max_tokens,
              temperature: reqJson.temperature,
            });
          };

          if (reqJson.stream) {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
              ...CORS_HEADERS,
            });

            // Run the agentic loop and stream events
            const loop = runAgenticLoop(
              messages as AgenticChatMessage[],
              requestedTools,
              toolRegistry,
              callModel,
            );

            for await (const event of loop) {
              if (event.event === "tool_call") {
                // Tool call events use event: prefix for SSE
                res.write(`event: tool_call\ndata: ${JSON.stringify(event.data)}\n\n`);
              } else if (event.event === "tool_result") {
                // Tool result events use event: prefix for SSE
                res.write(`event: tool_result\ndata: ${JSON.stringify(event.data)}\n\n`);
              } else if (event.event === "token") {
                // Regular token chunks remain as data: {...} (backward compatible)
                const tokenData = event.data as { content: string; stop: boolean };
                if (tokenData.stop) {
                  // Emit finish_reason stop chunk
                  res.write(
                    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
                  );
                } else if (tokenData.content) {
                  res.write(
                    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: tokenData.content }, finish_reason: null }] })}\n\n`,
                  );
                }
              } else if (event.event === "done") {
                res.write("data: [DONE]\n\n");
              }
            }

            return res.end();
          }

          // Non-streaming agentic path: collect all events and return final answer
          let finalContent = "";
          const loop = runAgenticLoop(
            messages as AgenticChatMessage[],
            requestedTools,
            toolRegistry,
            callModel,
          );

          for await (const event of loop) {
            if (event.event === "token") {
              const tokenData = event.data as { content: string; stop: boolean };
              if (!tokenData.stop && tokenData.content) {
                finalContent += tokenData.content;
              }
            }
          }

          return send(res, 200, {
            id,
            object: "chat.completion",
            created,
            model: modelId,
            choices: [
              { index: 0, message: { role: "assistant", content: finalContent }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        }

        // Standard path (no tools) — backward compatible
        const gen = ai.chat(messages, {
          maxTokens: reqJson.max_tokens,
          temperature: reqJson.temperature,
        });

        if (reqJson.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
            ...CORS_HEADERS,
          });
          // role delta first
          res.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
          );
          for await (const token of gen) {
            res.write(
              `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: token }, finish_reason: null }] })}\n\n`,
            );
          }
          res.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          return res.end();
        }

        // non-streaming: accumulate
        let content = "";
        for await (const token of gen) content += token;
        return send(res, 200, {
          id,
          object: "chat.completion",
          created,
          model: modelId,
          choices: [
            { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }

      send(res, 404, { error: { message: "not found", type: "invalid_request_error" } });
    } catch (e) {
      send(res, 500, { error: { message: String(e), type: "server_error" } });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}
