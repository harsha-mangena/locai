#!/usr/bin/env node
/**
 * `locai plan` — profile this device, then auto-select the optimal model+quant.
 * This is the moat, demonstrated end-to-end on real hardware.
 *
 * Run:
 *   node --experimental-strip-types packages/core/src/cli/plan.ts
 *   node --experimental-strip-types packages/core/src/cli/plan.ts --goal quality
 *   node --experimental-strip-types packages/core/src/cli/plan.ts --goal speed --context 16384
 */
import { profileDevice } from "../profiler/index.ts";
import { plan } from "../planner/index.ts";
import { SEED_CATALOG } from "../catalog/seed.ts";
import type { RunPlan } from "../types.ts";

const GiB = 1024 ** 3;
const fmt = (b: number) => (b / GiB).toFixed(2) + " GiB";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const goal = (arg("goal", "balanced") as "quality" | "speed" | "balanced");
const minContext = arg("context") ? Number(arg("context")) : undefined;

const device = profileDevice();
const result = plan({
  device,
  catalog: SEED_CATALOG,
  preference: { goal, minContext },
});

function printPlan(p: RunPlan, tag: string) {
  console.log(`\n  ${tag}: ${p.model.displayName}  ·  ${p.quant.id}  ·  ${p.backend}`);
  console.log("  " + "─".repeat(56));
  for (const r of p.rationale) console.log("    " + r);
  console.log(`\n    weights   ${fmt(p.predicted.weightsBytes)}`);
  console.log(`    kv cache  ${fmt(p.predicted.kvCacheBytes)} (${p.params.kvCacheType}, ctx ${p.params.contextLength})`);
  console.log(`    total     ${fmt(p.predicted.totalRuntimeBytes)}  ·  pressure ${(p.predicted.memoryPressure * 100).toFixed(0)}%  ·  fit ${p.predicted.fitClass}`);
  console.log(`    speed     ~${p.predicted.tokensPerSecEstimate} tok/s`);
  console.log(`    quality   ${(p.predicted.qualityRetention * 100).toFixed(0)}% retained  ·  score ${p.predicted.score.toFixed(3)}`);
  console.log(`    gpu       ${p.params.gpuLayers === "all" ? "all layers offloaded" : p.params.gpuLayers + " layers"}  ·  threads ${p.params.threads}  ·  spec-decode ${p.params.speculative ? "on" : "off"}`);
  console.log(`    confidence ${(p.confidence * 100).toFixed(0)}%`);
}

console.log(`\n  LocAI Auto-Plan  ·  goal="${goal}"  ·  device=${device.cpu.brand} (${fmt(device.usableRamBytes)} usable)`);
console.log("  " + "═".repeat(58));

if (!result.best) {
  console.log("\n  No feasible plan — device too constrained for the catalog.\n");
  process.exit(1);
}

printPlan(result.best, "★ BEST");

if (result.alternatives.length) {
  console.log("\n\n  Alternatives considered:");
  for (const a of result.alternatives) {
    console.log(
      `    ${a.model.displayName.padEnd(26)} ${a.quant.id.padEnd(8)} ${String(a.predicted.tokensPerSecEstimate).padStart(5)} tok/s  ${(a.predicted.qualityRetention * 100).toFixed(0)}% q  ${(a.predicted.memoryPressure * 100).toFixed(0)}% mem  score ${a.predicted.score.toFixed(3)}`,
    );
  }
}
console.log(`\n  (${result.rejected} candidates rejected as infeasible)\n`);
