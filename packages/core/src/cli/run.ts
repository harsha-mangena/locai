#!/usr/bin/env node
/**
 * `locai run` — auto-profile, auto-plan, load the best local model, and chat.
 *
 * Usage:
 *   npm run run:chat "your prompt"
 *   npm run run:chat -- --goal quality "write me an essay on AI in 2026"
 *   npm run run:chat -- --max-tokens 4096 "summarise this"
 *   npm run run:chat -- --no-thinking "quick answer please"   (reasoning models only)
 *   npm run run:chat -- --temperature 0.9 "be creative"
 *
 * Token limit:
 *   By default there is NO token limit — the model generates until its own
 *   stop tokens or the context window fills. Use --max-tokens only when you
 *   need a hard ceiling (e.g. API cost control, UI truncation).
 *
 * Reasoning models (Qwen3, DeepSeek-R1, Phi-4-reasoning):
 *   These emit a <think>...</think> block before the answer. This is the model
 *   working through the problem — it significantly improves quality on complex
 *   tasks. Use --no-thinking to skip it for simple/fast queries.
 */
import { LocAI } from "../runtime/locai.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes("--" + name);
}

const goal        = (arg("goal") as "quality" | "speed" | "balanced") ?? "balanced";
const maxTokens   = arg("max-tokens")   ? Number(arg("max-tokens"))   : undefined;
const temperature = arg("temperature")  ? Number(arg("temperature"))  : undefined;
const topP        = arg("top-p")        ? Number(arg("top-p"))        : undefined;
const topK        = arg("top-k")        ? Number(arg("top-k"))        : undefined;
const minP        = arg("min-p")        ? Number(arg("min-p"))        : undefined;
// --no-thinking disables the reasoning block for reasoning models.
// Default: thinking ON (better quality).
const enableThinking = !flag("no-thinking");

// Collect positional args (everything that isn't a --flag or its value).
const flagsWithValues = new Set(["goal", "max-tokens", "temperature", "top-p", "top-k", "min-p"]);
const positional: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const name = argv[i].slice(2);
    if (flagsWithValues.has(name)) i++; // skip the value token
  } else {
    positional.push(argv[i]);
  }
}

const prompt = positional.join(" ") || "In one sentence, what is LocAI?";

// ---------------------------------------------------------------------------

const t0 = Date.now();
process.stderr.write("  LocAI: profiling device and selecting model…\n");
const ai = await LocAI.create({ goal });

const rp = ai.runPlan;
if (!rp) {
  process.stderr.write(
    "  No local model available. Run `npm run plan` to see download options.\n",
  );
  process.exit(1);
}

const isReasoning = rp.model.supportsReasoning ?? false;
process.stderr.write(
  `  → ${rp.model.displayName} (${rp.quant.id}) on ${rp.backend}` +
  `${isReasoning ? " [reasoning]" : ""}` +
  `, ~${rp.predicted.tokensPerSecEstimate} tok/s est.\n`,
);
if (maxTokens !== undefined) {
  process.stderr.write(`  → max tokens: ${maxTokens}\n`);
} else {
  process.stderr.write(`  → no token limit (model decides)\n`);
}
if (isReasoning) {
  process.stderr.write(
    enableThinking
      ? `  → thinking: ON  (model will show reasoning trace)\n`
      : `  → thinking: OFF (--no-thinking)\n`,
  );
}
process.stderr.write(`  → loading…\n\n`);

await ai.ensureLoaded();
const loadMs = Date.now() - t0;

process.stdout.write("  ");
let tokens = 0;
const genStart = Date.now();

for await (const tok of ai.chat(
  [{ role: "user", content: prompt }],
  { maxTokens, temperature, topP, topK, minP, enableThinking },
)) {
  process.stdout.write(tok);
  tokens++;
}

const genMs = Date.now() - genStart;
process.stderr.write(
  `\n\n  [${tokens} tokens · ${(tokens / (genMs / 1000)).toFixed(1)} tok/s actual · load ${(loadMs / 1000).toFixed(1)}s]\n`,
);

await ai.close();
process.exit(0);
