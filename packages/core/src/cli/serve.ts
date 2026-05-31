#!/usr/bin/env node
/**
 * `locai serve` — start the OpenAI-compatible server backed by the auto-planned
 * local model. Point any OpenAI client at http://127.0.0.1:8080/v1.
 *
 * Usage:
 *   node --experimental-strip-types packages/core/src/cli/serve.ts
 *   node --experimental-strip-types packages/core/src/cli/serve.ts --goal quality --port 8080
 */
import { LocAI } from "../runtime/locai.ts";
import { serve } from "../server/openai.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const goal = (arg("goal") as "quality" | "speed" | "balanced") ?? "balanced";
const port = Number(arg("port") ?? 8080);

process.stderr.write("  LocAI: profiling device and selecting model…\n");
const ai = await LocAI.create({ goal });
process.stderr.write(`  → ${ai.runPlan.model.displayName} (${ai.runPlan.quant.id}) on ${ai.runPlan.backend}\n`);
process.stderr.write("  → loading model…\n");
await ai.ensureLoaded();

const server = await serve({ ai, port });
process.stderr.write(`\n  ✓ LocAI serving on http://127.0.0.1:${port}/v1\n`);
process.stderr.write(`    model:    ${ai.runPlan.model.id}\n`);
process.stderr.write(`    plan:     GET  /locai/plan\n`);
process.stderr.write(`    chat:     POST /v1/chat/completions\n\n`);

const shutdown = async () => {
  process.stderr.write("\n  shutting down…\n");
  server.close();
  await ai.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
