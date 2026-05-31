#!/usr/bin/env node
/**
 * `locai profile` — introspect THIS device and print its LocAI profile.
 * Run: node --experimental-strip-types packages/core/src/cli/profile.ts
 */
import { profileDevice } from "../profiler/index.ts";

const GiB = 1024 ** 3;
const fmt = (b?: number) => (b == null ? "—" : (b / GiB).toFixed(1) + " GiB");

const p = profileDevice();

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}

console.log("\n  LocAI — Device Profile\n  " + "─".repeat(46));
console.log(`  Platform        ${p.platform} / ${p.arch}`);
console.log(`  CPU             ${p.cpu.brand}`);
console.log(`  Cores           ${p.cpu.physicalCores} physical / ${p.cpu.logicalCores} logical`);
console.log(`  SIMD features   ${p.cpu.features.join(", ") || "baseline"}`);
console.log(`  RAM total       ${fmt(p.totalRamBytes)}`);
console.log(`  RAM usable      ${fmt(p.usableRamBytes)}  (planner budget)`);
if (p.memoryBandwidthGBs) console.log(`  Mem bandwidth   ~${p.memoryBandwidthGBs} GB/s`);
console.log(`  Thermal limit   ${p.thermallyConstrained ? "yes (mobile/fanless)" : "no"}`);
console.log(`  Free disk       ${fmt(p.freeDiskBytes)}`);
console.log("\n  Accelerators (best first):");
for (const a of p.accelerators) {
  const mem = a.memoryBytes ? `, ${fmt(a.memoryBytes)}${a.unifiedMemory ? " unified" : ""}` : "";
  console.log(`    • ${a.kind.padEnd(8)} ${a.name}${mem}`);
}
console.log("");
