#!/usr/bin/env node
/**
 * `locai plan` — profile this device, then show the full strategy cascade:
 *   - what runs RIGHT NOW (system model / local GGUF / browser)
 *   - what to download for the best local experience
 *   - why each decision was made
 *
 * Run:
 *   node --experimental-strip-types packages/core/src/cli/plan.ts
 *   node --experimental-strip-types packages/core/src/cli/plan.ts --goal quality
 *   node --experimental-strip-types packages/core/src/cli/plan.ts --goal speed --context 16384
 */
import { profileDevice } from "../profiler/index.ts";
import { plan } from "../planner/index.ts";
import { selectStrategy } from "../planner/strategy.ts";
import { ModelHub } from "../catalog/hub.ts";
import { SEED_CATALOG } from "../catalog/seed.ts";
import type { RunPlan, StrategyPlan } from "../types.ts";
import path from "node:path";
import os from "node:os";

const GiB = 1024 ** 3;
const fmt = (b: number) => (b / GiB).toFixed(2) + " GiB";
const fmtMB = (b: number) => b >= GiB ? (b / GiB).toFixed(1) + " GB" : (b / (1024 * 1024)).toFixed(0) + " MB";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const goal = (arg("goal", "balanced") as "quality" | "speed" | "balanced");
const minContext = arg("context") ? Number(arg("context")) : undefined;
const modelsDir = arg("models-dir") ?? path.join(os.homedir(), "Work/locai/models");

const device = profileDevice();

// Build hub to know what's on disk.
const hub = new ModelHub({ modelsDir, catalog: SEED_CATALOG });
const localCatalog = hub.available();

// Run the strategy cascade.
const strategyPlan = selectStrategy({
  device,
  localCatalog,
  fullCatalog: SEED_CATALOG,
  preference: { goal, minContext },
});

// Also run the raw planner for detailed plan output (if local models exist).
const rawResult = localCatalog.length > 0
  ? plan({ device, catalog: localCatalog, preference: { goal, minContext } })
  : null;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const STRATEGY_LABELS: Record<string, string> = {
  "system-model":   "SYSTEM MODEL  (OS-provided, zero download)",
  "native-local":   "NATIVE LOCAL  (GGUF on disk, llama.cpp)",
  "flash-backed":   "FLASH-BACKED  (DRAM+Flash hybrid)",
  "browser-webgpu": "BROWSER       (WebGPU, model in OPFS)",
  "browser-wasm":   "BROWSER       (WASM, model in OPFS)",
  "hybrid-edge":    "HYBRID EDGE   (opt-in cloud fallback)",
};

console.log(`\n  LocAI Strategy Plan  ·  goal="${goal}"  ·  ${device.cpu.brand}`);
console.log(`  Device: ${device.platform}/${device.arch}  ·  ${fmt(device.usableRamBytes)} usable RAM  ·  ${device.freeDiskBytes ? fmtMB(device.freeDiskBytes) + " free disk" : "disk unknown"}`);
console.log("  " + "═".repeat(62));

// Current strategy.
console.log(`\n  ▶ NOW:  ${STRATEGY_LABELS[strategyPlan.strategy] ?? strategyPlan.strategy}`);
console.log("  " + "─".repeat(62));
for (const r of strategyPlan.rationale) {
  console.log("    " + r);
}

// Detailed plan if native-local.
if (strategyPlan.strategy === "native-local" && strategyPlan.runPlan) {
  printRunPlan(strategyPlan.runPlan, "");
}

// Pending upgrade.
if (strategyPlan.pendingUpgrade) {
  const { strategy, runPlan, downloadPlan } = strategyPlan.pendingUpgrade;
  console.log(`\n  ⬇ UPGRADE AVAILABLE:  ${STRATEGY_LABELS[strategy] ?? strategy}`);
  console.log("  " + "─".repeat(62));
  console.log(`    Download: ${runPlan.model.displayName} (${runPlan.quant.id})`);
  console.log(`    Size:     ${fmtMB(downloadPlan.sizeBytes)}${downloadPlan.estimatedMinutes ? `  ·  ~${downloadPlan.estimatedMinutes} min on WiFi` : ""}`);
  console.log(`    Resumable: ${downloadPlan.resumable ? "yes" : "no"}  ·  WiFi-only recommended: ${downloadPlan.wifiOnly ? "yes" : "no"}`);
  printRunPlan(runPlan, "    ");
}

// Download plan if no local model.
if (strategyPlan.downloadPlan && !strategyPlan.pendingUpgrade) {
  const dp = strategyPlan.downloadPlan;
  console.log(`\n  ⬇ RECOMMENDED DOWNLOAD:`);
  console.log("  " + "─".repeat(62));
  console.log(`    Size:     ${fmtMB(dp.sizeBytes)}${dp.estimatedMinutes ? `  ·  ~${dp.estimatedMinutes} min on WiFi` : ""}`);
  console.log(`    URL:      ${dp.url}`);
  console.log(`    Resumable: ${dp.resumable ? "yes" : "no"}  ·  WiFi-only: ${dp.wifiOnly ? "yes" : "no"}`);
}

// Alternatives (from raw planner, if local models exist).
if (rawResult?.alternatives.length) {
  console.log("\n\n  Alternatives (local models):");
  for (const a of rawResult.alternatives) {
    console.log(
      `    ${a.model.displayName.padEnd(26)} ${a.quant.id.padEnd(8)} ` +
      `${String(a.predicted.tokensPerSecEstimate).padStart(5)} tok/s  ` +
      `${(a.predicted.qualityRetention * 100).toFixed(0)}% q  ` +
      `${(a.predicted.memoryPressure * 100).toFixed(0)}% mem  ` +
      `score ${a.predicted.score.toFixed(3)}`,
    );
  }
}

// Storage summary.
const storageUsed = hub.storageUsed();
if (storageUsed > 0) {
  console.log(`\n  Storage: ${fmtMB(storageUsed)} used by downloaded models`);
}

console.log("");

// ---------------------------------------------------------------------------

function printRunPlan(p: RunPlan, indent: string) {
  console.log(`\n${indent}  Model:    ${p.model.displayName}  ·  ${p.quant.id}  ·  ${p.backend}`);
  console.log(`${indent}  weights   ${fmt(p.predicted.weightsBytes)}`);
  console.log(`${indent}  kv cache  ${fmt(p.predicted.kvCacheBytes)} (${p.params.kvCacheType}, ctx ${p.params.contextLength})`);
  console.log(`${indent}  total     ${fmt(p.predicted.totalRuntimeBytes)}  ·  pressure ${(p.predicted.memoryPressure * 100).toFixed(0)}%  ·  fit ${p.predicted.fitClass}`);
  console.log(`${indent}  speed     ~${p.predicted.tokensPerSecEstimate} tok/s`);
  console.log(`${indent}  quality   ${(p.predicted.qualityRetention * 100).toFixed(0)}% retained  ·  score ${p.predicted.score.toFixed(3)}`);
  console.log(`${indent}  gpu       ${p.params.gpuLayers === "all" ? "all layers offloaded" : p.params.gpuLayers + " layers"}  ·  threads ${p.params.threads}`);
  console.log(`${indent}  confidence ${(p.confidence * 100).toFixed(0)}%`);
}
