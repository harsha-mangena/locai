/**
 * Chat templating — turn OpenAI-style messages into a model's prompt string.
 *
 * MVP supports the Llama 3 / Qwen2.5 chat formats (our seed catalog). The engine
 * receives a single prompt string; this is where role structure becomes tokens.
 * Detected by model id; defaults to a generic template.
 */

import type { ModelDescriptor } from "../types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function llama3Template(messages: ChatMessage[]): string {
  let out = "<|begin_of_text|>";
  for (const m of messages) {
    out += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
  }
  out += "<|start_header_id|>assistant<|end_header_id|>\n\n";
  return out;
}

function chatmlTemplate(messages: ChatMessage[]): string {
  // Qwen2.5 / ChatML
  let out = "";
  for (const m of messages) {
    out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  out += "<|im_start|>assistant\n";
  return out;
}

export function formatPrompt(model: ModelDescriptor, messages: ChatMessage[]): {
  prompt: string;
  stop: string[];
} {
  const id = model.id.toLowerCase();
  if (id.includes("llama-3") || id.includes("llama3")) {
    return { prompt: llama3Template(messages), stop: ["<|eot_id|>", "<|end_of_text|>"] };
  }
  if (id.includes("qwen") || id.includes("phi-4")) {
    return { prompt: chatmlTemplate(messages), stop: ["<|im_end|>"] };
  }
  // Generic fallback.
  const prompt =
    messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n") + "\nASSISTANT: ";
  return { prompt, stop: ["\nUSER:", "\nSYSTEM:"] };
}
