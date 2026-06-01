/**
 * Agentic Loop — drives the model through tool calls until a final answer.
 *
 * Yields SSE events for tool_call, tool_result, token, and done.
 * Enforces a configurable max iteration guard (default 10).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { ToolRegistry, type OpenAITool } from "../tools/registry.ts";
import { ToolExecutor } from "../tools/executor.ts";
import type { ToolDefinition } from "../tools/registry.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
}

export interface ModelToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ModelResponse {
  content: string | null;
  tool_calls?: ModelToolCall[];
}

export type AgenticSSEEvent =
  | { event: "tool_call"; data: { id: string; name: string; arguments: Record<string, unknown> } }
  | { event: "tool_result"; data: { id: string; name: string; results: unknown } }
  | { event: "token"; data: { content: string; stop: boolean } }
  | { event: "done" };

export interface AgenticLoopOptions {
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Agentic Loop
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Runs the agentic loop as an async generator yielding SSE events.
 *
 * - If `tools` is empty or undefined, yields token events directly (no-tools fast path).
 * - Otherwise, iterates: call model → execute tool calls → feed results back.
 * - Stops when the model returns no tool_calls (final answer) or max iterations reached.
 */
export async function* runAgenticLoop(
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  registry: ToolRegistry,
  callModel: (messages: ChatMessage[], tools: OpenAITool[]) => Promise<ModelResponse>,
  opts?: AgenticLoopOptions
): AsyncGenerator<AgenticSSEEvent> {
  const maxIterations = opts?.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // No-tools fast path: call model once and yield token events directly
  if (!tools || tools.length === 0) {
    const openAITools: OpenAITool[] = [];
    const response = await callModel(messages, openAITools);
    const content = response.content ?? "";
    if (content) {
      yield { event: "token", data: { content, stop: false } };
    }
    yield { event: "token", data: { content: "", stop: true } };
    yield { event: "done" };
    return;
  }

  // Build OpenAI tools format from the provided tool definitions, preserving
  // the caller's allow-list instead of exposing every registered tool.
  const openAITools: OpenAITool[] = tools.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
  const executor = new ToolExecutor(registry);

  let iteration = 0;

  while (iteration < maxIterations) {
    const response = await callModel(messages, openAITools);

    // If the model returns tool_calls, execute them
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Yield tool_call events
      for (const toolCall of response.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          // If args can't be parsed, pass empty object in the event
          // The executor will handle the malformed JSON separately
        }

        yield {
          event: "tool_call",
          data: {
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: parsedArgs,
          },
        };
      }

      // Append the assistant message before tool results so the transcript
      // follows OpenAI's order: assistant(tool_calls) -> tool(result).
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call sequentially and yield results
      for (const toolCall of response.tool_calls) {
        const result = await executor.execute({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });

        // Parse result for the SSE event
        let parsedResult: unknown;
        try {
          parsedResult = JSON.parse(result);
        } catch {
          parsedResult = result;
        }

        yield {
          event: "tool_result",
          data: {
            id: toolCall.id,
            name: toolCall.function.name,
            results: parsedResult,
          },
        };

        // Append tool result as a tool message
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: toolCall.id,
        });
      }

      iteration++;

      // Check iteration limit
      if (iteration >= maxIterations) {
        yield {
          event: "token",
          data: {
            content: "\n\n[Warning: Maximum tool call iterations reached. Returning partial response.]",
            stop: false,
          },
        };
        yield { event: "token", data: { content: "", stop: true } };
        break;
      }
    } else {
      // No tool_calls — this is the final answer
      const content = response.content ?? "";
      if (content) {
        yield { event: "token", data: { content, stop: false } };
      }
      yield { event: "token", data: { content: "", stop: true } };
      break;
    }
  }

  yield { event: "done" };
}
