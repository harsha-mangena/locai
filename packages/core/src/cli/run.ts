#!/usr/bin/env node
/**
 * `locai run` — auto-profile, auto-plan, load the best local model, and chat.
 * Usage:
 *   node --experimental-strip-types packages/core/src/cli/run.ts "your prompt"
 *   node --experimental-strip-types packages/core/src/cli/run.ts --goal speed "hi"
 */
import { LocAI } from "../runtime/locai.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const goal = (arg("goal") as "quality" | "speed" | "balanced") ?? "balanced";
const prompt =
  process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== goal).join(" ") ||
  "In one sentence, what is LocAI?";

const t0 = Date.now();
process.stderr.write("  LocAI: profiling device and selecting model…\n");
const ai = await LocAI.create({ goal });

process.stderr.write(
  `  → ${ai.runPlan.model.displayName} (${ai.runPlan.quant.id}) on ${ai.runPlan.backend}, ~${ai.runPlan.predicted.tokensPerSecEstimate} tok/s est.\n`,
);
process.stderr.write(`  → loading…\n\n`);

await ai.ensureLoaded();
const loadMs = Date.now() - t0;

process.stdout.write("  ");
let tokens = 0;
const genStart = Date.now();
for await (const tok of ai.chat([{ role: "user", content: prompt }], { maxTokens: 256 })) {
  process.stdout.write(tok);
  tokens++;
}
const genMs = Date.now() - genStart;

process.stderr.write(
  `\n\n  [${tokens} tokens · ${(tokens / (genMs / 1000)).toFixed(1)} tok/s actual · load ${(loadMs / 1000).toFixed(1)}s]\n`,
);
await ai.close();
process.exit(0);
