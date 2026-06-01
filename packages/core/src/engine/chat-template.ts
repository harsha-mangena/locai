/**
 * Chat templating — turn OpenAI-style messages into a model's prompt string.
 *
 * Each model family has a specific prompt format baked into its weights at
 * training time. Using the wrong template produces incoherent output regardless
 * of model quality — this is one of the most common silent failure modes in
 * local LLM deployments.
 *
 * Supported families (2025/2026 catalog):
 *   llama3      — Meta Llama 3.x  (<|begin_of_text|> / <|eot_id|>)
 *   chatml      — Qwen2.x, Phi-3/4, many others  (<|im_start|> / <|im_end|>)
 *   qwen3       — Qwen3 family: ChatML + optional /think disable token
 *   deepseek-r1 — DeepSeek-R1: ChatML + <think>...</think> reasoning block
 *   gemma       — Google Gemma 2/3  (<start_of_turn> / <end_of_turn>)
 *   mistral     — Mistral/Mixtral  ([INST] / [/INST])
 *   phi4-mini   — Phi-4-mini  (<|user|> / <|end|> / <|assistant|>)
 *   generic     — Safe fallback: ROLE: content\n
 *
 * Reasoning model handling:
 *   Models like Qwen3, DeepSeek-R1, Phi-4-reasoning emit a <think>...</think>
 *   block before their answer. The runtime can:
 *     - stream it as-is (default — user sees the reasoning)
 *     - strip it (set stripThinking: true — user sees only the answer)
 *   The thinking block is NOT a bug. It's the model working through the problem.
 *   For long-form tasks (essays, code, analysis) it significantly improves quality.
 */

import type { ModelDescriptor, ChatTemplateFormat } from "../types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface FormatResult {
  prompt: string;
  stop: string[];
}

// ---------------------------------------------------------------------------
// Template implementations
// ---------------------------------------------------------------------------

function llama3Template(messages: ChatMessage[]): FormatResult {
  let out = "<|begin_of_text|>";
  for (const m of messages) {
    out += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
  }
  out += "<|start_header_id|>assistant<|end_header_id|>\n\n";
  return {
    prompt: out,
    stop: ["<|eot_id|>", "<|end_of_text|>"],
  };
}

function chatMLTemplate(messages: ChatMessage[]): FormatResult {
  // Used by: Qwen2.x, Phi-3, Phi-4, InternLM2, many fine-tunes
  let out = "";
  for (const m of messages) {
    out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  out += "<|im_start|>assistant\n";
  return {
    prompt: out,
    stop: ["<|im_end|>", "<|endoftext|>"],
  };
}

function qwen3Template(messages: ChatMessage[], enableThinking: boolean): FormatResult {
  // Qwen3 uses ChatML but with /think or /no_think appended to the last user message
  // to control reasoning mode. When thinking is enabled, the model emits
  // <think>...</think> before the answer.
  let out = "";
  const lastUserIdx = messages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i === lastUserIdx) {
      // Append /think or /no_think to the last user message content
      const suffix = enableThinking ? " /think" : " /no_think";
      out += `<|im_start|>${m.role}\n${m.content}${suffix}<|im_end|>\n`;
    } else {
      out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
    }
  }
  out += "<|im_start|>assistant\n";
  return {
    prompt: out,
    stop: ["<|im_end|>", "<|endoftext|>"],
  };
}

function deepseekR1Template(messages: ChatMessage[]): FormatResult {
  // DeepSeek-R1 uses its own format: <|User|>...<|Assistant|><think>\n
  // The trailing <think> elicits chain-of-thought reasoning before the answer.
  // System messages are prepended to the first user message.
  let out = "";
  let systemContent = "";
  for (const m of messages) {
    if (m.role === "system") {
      systemContent += (systemContent ? "\n" : "") + m.content;
    } else if (m.role === "user") {
      const content = systemContent ? `${systemContent}\n\n${m.content}` : m.content;
      systemContent = ""; // only prepend to first user message
      out += `<|User|>${content}`;
    } else if (m.role === "assistant") {
      out += `<|Assistant|>${m.content}`;
    }
  }
  out += "<|Assistant|><think>\n";
  return {
    prompt: out,
    stop: ["<|end_of_sentence|>", "<|User|>"],
  };
}

function gemmaTemplate(messages: ChatMessage[]): FormatResult {
  // Gemma 2 / Gemma 3
  let out = "";
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : m.role;
    out += `<start_of_turn>${role}\n${m.content}<end_of_turn>\n`;
  }
  out += "<start_of_turn>model\n";
  return {
    prompt: out,
    stop: ["<end_of_turn>", "<eos>"],
  };
}

function mistralTemplate(messages: ChatMessage[]): FormatResult {
  // Mistral v1/v2/v3, Mixtral
  // System message is prepended to the first user message (no system role in v1).
  let out = "<s>";
  let systemContent = "";
  const filtered = messages.filter((m) => {
    if (m.role === "system") { systemContent = m.content; return false; }
    return true;
  });
  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    if (m.role === "user") {
      const content = i === 0 && systemContent ? `${systemContent}\n\n${m.content}` : m.content;
      out += `[INST] ${content} [/INST]`;
    } else if (m.role === "assistant") {
      out += ` ${m.content}</s>`;
    }
  }
  return {
    prompt: out,
    stop: ["</s>", "[INST]"],
  };
}

function phi4MiniTemplate(messages: ChatMessage[]): FormatResult {
  // Phi-4-mini uses a different format from Phi-4 base
  let out = "";
  for (const m of messages) {
    if (m.role === "system") {
      out += `<|system|>\n${m.content}<|end|>\n`;
    } else if (m.role === "user") {
      out += `<|user|>\n${m.content}<|end|>\n`;
    } else {
      out += `<|assistant|>\n${m.content}<|end|>\n`;
    }
  }
  out += "<|assistant|>\n";
  return {
    prompt: out,
    stop: ["<|end|>", "<|endoftext|>"],
  };
}

function genericTemplate(messages: ChatMessage[]): FormatResult {
  const prompt =
    messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n") +
    "\nASSISTANT: ";
  return {
    prompt,
    stop: ["\nUSER:", "\nSYSTEM:"],
  };
}

// ---------------------------------------------------------------------------
// Template detection from model id (fallback when chatTemplate not set)
// ---------------------------------------------------------------------------

export function detectTemplateFormat(modelId: string): ChatTemplateFormat {
  const id = modelId.toLowerCase();

  if (id.includes("deepseek-r1") || id.includes("deepseek_r1")) return "deepseek-r1";
  if (id.includes("qwen3")) return "qwen3";
  if (id.includes("llama-3") || id.includes("llama3")) return "llama3";
  if (id.includes("gemma")) return "gemma";
  if (id.includes("mistral") || id.includes("mixtral")) return "mistral";
  if (id.includes("phi-4-mini") || id.includes("phi4-mini")) return "phi4-mini";
  // Qwen2.x, Phi-4, InternLM2, and many fine-tunes use ChatML
  if (id.includes("qwen") || id.includes("phi-4") || id.includes("phi4") || id.includes("internlm")) return "chatml";

  return "generic";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormatOptions {
  /**
   * For reasoning models (Qwen3, DeepSeek-R1, Phi-4-reasoning):
   * whether to enable the thinking/reasoning block.
   * Default: true — reasoning is ON by default for better quality.
   * Set to false for faster responses where reasoning isn't needed.
   */
  enableThinking?: boolean;
}

export function formatPrompt(
  model: ModelDescriptor,
  messages: ChatMessage[],
  opts: FormatOptions = {},
): FormatResult {
  const enableThinking = opts.enableThinking ?? true;

  // Use the explicit chatTemplate from the catalog if set, otherwise detect.
  const format: ChatTemplateFormat = model.chatTemplate ?? detectTemplateFormat(model.id);

  switch (format) {
    case "llama3":      return llama3Template(messages);
    case "chatml":      return chatMLTemplate(messages);
    case "qwen3":       return qwen3Template(messages, enableThinking);
    case "deepseek-r1": return deepseekR1Template(messages);
    case "gemma":       return gemmaTemplate(messages);
    case "mistral":     return mistralTemplate(messages);
    case "phi4-mini":   return phi4MiniTemplate(messages);
    case "generic":
    default:            return genericTemplate(messages);
  }
}

/**
 * Strip <think>...</think> blocks from a completed response.
 * Use this when you want to show only the final answer, not the reasoning trace.
 * The thinking block is preserved in the raw stream for callers that want it.
 */
export function stripThinkingBlock(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

/**
 * Extract just the thinking block from a response, if present.
 * Returns null if no thinking block found.
 */
export function extractThinkingBlock(text: string): string | null {
  const match = text.match(/<think>([\s\S]*?)<\/think>/);
  return match ? match[1].trim() : null;
}
