/**
 * Local-model tool calling adapter.
 *
 * OpenAI-hosted models can emit native `tool_calls`. Plain local GGUF models
 * usually cannot, so we give them a small, deterministic text protocol and
 * parse it back into OpenAI-compatible tool calls.
 */

import type { ChatMessage as EngineChatMessage } from "../engine/chat-template.ts";
import type { OpenAITool } from "../tools/registry.ts";
import type {
  ChatMessage as AgenticChatMessage,
  ModelResponse,
  ModelToolCall,
} from "./agentic.ts";

const TOOL_TAG_OPEN = "<locai_tool_calls>";
const TOOL_TAG_CLOSE = "</locai_tool_calls>";

export function toolCallingSystemPrompt(tools: OpenAITool[]): string {
  const specs = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));

  return [
    "You are running inside LocAI with access to local tools.",
    "Use a tool only when it materially helps answer the user.",
    "When you need tools, respond with exactly one JSON array wrapped in these tags:",
    `${TOOL_TAG_OPEN}[{"name":"tool_name","arguments":{"key":"value"}}]${TOOL_TAG_CLOSE}`,
    "Do not include prose outside the tags when calling tools.",
    "After tool results are provided, answer the user normally unless another tool is needed.",
    "Available tools:",
    JSON.stringify(specs),
  ].join("\n");
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function extractTaggedJson(text: string): unknown | null {
  const start = text.indexOf(TOOL_TAG_OPEN);
  const end = text.indexOf(TOOL_TAG_CLOSE);
  if (start === -1 || end === -1 || end <= start) return null;

  const json = text.slice(start + TOOL_TAG_OPEN.length, end).trim();
  return JSON.parse(json);
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseLooseJson(text: string): unknown | null {
  const stripped = stripJsonFence(text);
  if (!stripped.startsWith("{") && !stripped.startsWith("[")) return null;
  return JSON.parse(stripped);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeToolCall(
  value: unknown,
  index: number,
  allowedNames: Set<string>,
): ModelToolCall | null {
  const obj = asObject(value);
  if (!obj) return null;

  const fn = asObject(obj.function);
  const name = typeof obj.name === "string"
    ? obj.name
    : typeof fn?.name === "string"
      ? fn.name
      : "";

  if (!name || !allowedNames.has(name)) return null;

  const rawArgs = obj.arguments ?? fn?.arguments ?? {};
  const argString = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);

  return {
    id: typeof obj.id === "string" ? obj.id : `call_${Date.now().toString(36)}_${index}`,
    type: "function",
    function: {
      name,
      arguments: argString,
    },
  };
}

function normalizeToolCalls(value: unknown, allowedNames: Set<string>): ModelToolCall[] {
  const root = asObject(value);
  const rawCalls = Array.isArray(value)
    ? value
    : Array.isArray(root?.tool_calls)
      ? root.tool_calls
      : Array.isArray(root?.tools)
        ? root.tools
        : root
          ? [root]
          : [];

  return rawCalls
    .map((call, index) => normalizeToolCall(call, index, allowedNames))
    .filter((call): call is ModelToolCall => call !== null);
}

export function parseModelToolResponse(content: string, tools: OpenAITool[]): ModelResponse {
  const allowedNames = new Set(tools.map((tool) => tool.function.name));
  const cleaned = stripThinking(content);

  const attempts = [
    () => extractTaggedJson(cleaned),
    () => parseLooseJson(cleaned),
  ];

  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (parsed == null) continue;
      const toolCalls = normalizeToolCalls(parsed, allowedNames);
      if (toolCalls.length > 0) {
        return { content: null, tool_calls: toolCalls };
      }
    } catch {
      // Keep the raw model response as final text if structured parsing fails.
    }
  }

  return { content, tool_calls: undefined };
}

function summarizeAssistantToolCalls(toolCalls: ModelToolCall[]): string {
  return `Tool calls requested: ${toolCalls
    .map((call) => `${call.function.name}(${call.function.arguments})`)
    .join(", ")}`;
}

export function toEngineMessages(
  messages: AgenticChatMessage[],
  tools: OpenAITool[],
  systemPrompt?: string,
): EngineChatMessage[] {
  const converted: EngineChatMessage[] = [
    {
      role: "system",
      content: [systemPrompt, tools.length > 0 ? toolCallingSystemPrompt(tools) : ""]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  for (const message of messages) {
    if (message.role === "tool") {
      converted.push({
        role: "user",
        content: `Tool result for ${message.tool_call_id ?? "unknown"}:\n${message.content ?? ""}`,
      });
    } else if (message.role === "assistant" && message.tool_calls?.length) {
      converted.push({
        role: "assistant",
        content: message.content ?? summarizeAssistantToolCalls(message.tool_calls),
      });
    } else if (message.role === "system") {
      converted.push({ role: "system", content: message.content ?? "" });
    } else {
      converted.push({
        role: message.role,
        content: message.content ?? "",
      });
    }
  }

  return converted;
}
