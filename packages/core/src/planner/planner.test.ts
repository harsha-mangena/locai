/**
 * Planner physics + decision tests.
 * Run: node --experimental-strip-types --test packages/core/src/planner/planner.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { plan } from "./index.ts";
import { weightBytes, kvCacheBytes, totalRuntimeBytes, tokensPerSecEstimate } from "./resource.ts";
import { qualityRetentionForBpw, effectiveCapability } from "./quality.ts";
import { SEED_CATALOG } from "../catalog/seed.ts";
import { estimateUsableRam } from "../profiler/node.ts";
import type { DeviceProfile, ModelDescriptor, QuantSpec } from "../types.ts";

const GiB = 1024 ** 3;

function mkDevice(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    platform: "macos",
    arch: "arm64",
    totalRamBytes: 16 * GiB,
    usableRamBytes: 12.8 * GiB,
    cpu: { brand: "Apple M1 Pro", physicalCores: 8, logicalCores: 8, features: ["neon", "dotprod"] },
    accelerators: [
      { kind: "metal", name: "M1 Pro GPU", memoryBytes: 16 * GiB, unifiedMemory: true, perfHint: 0.85, available: true },
      { kind: "cpu", name: "M1 Pro", memoryBytes: 16 * GiB, unifiedMemory: true, perfHint: 0.3, available: true },
    ],
    memoryBandwidthGBs: 200,
    thermallyConstrained: false,
    capturedAt: new Date().toISOString(),
    source: "synthetic",
    ...overrides,
  };
}

const model7b = SEED_CATALOG.find((m) => m.id === "qwen2.5-7b-instruct")!;

test("weightBytes: 7.6B at 4.9bpw ≈ 4.65 GiB", () => {
  const q: QuantSpec = { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, qualityRetention: 0.978 };
  const bytes = weightBytes(model7b, q);
  const gib = bytes / GiB;
  assert.ok(gib > 4.2 && gib < 4.7, `expected ~4.3-4.6 GiB, got ${gib.toFixed(2)}`);
});

test("kvCacheBytes: GQA model has small cache; q4_0 << f16", () => {
  const f16 = kvCacheBytes(model7b, 8192, "f16");
  const q4 = kvCacheBytes(model7b, 8192, "q4_0");
  assert.ok(q4 < f16, "q4 cache must be smaller than f16");
  assert.ok(Math.abs(q4 / f16 - 0.25) < 0.01, "q4_0 should be ~1/4 of f16");
});

test("kvCacheBytes: GQA cache much smaller than non-GQA equivalent", () => {
  const gqa = kvCacheBytes(model7b, 8192, "f16");
  const nonGqa = kvCacheBytes({ ...model7b, gqa: false, numKeyValueHeads: model7b.numAttentionHeads }, 8192, "f16");
  assert.ok(gqa < nonGqa * 0.5, "GQA should cut cache by >2x here");
});

test("quality curve: imatrix recovers low-bit, monotonic in bpw", () => {
  assert.ok(qualityRetentionForBpw(8) > qualityRetentionForBpw(4));
  assert.ok(qualityRetentionForBpw(4) > qualityRetentionForBpw(2));
  // imatrix boosts the 3bpw point
  assert.ok(qualityRetentionForBpw(3, { imatrix: true }) > qualityRetentionForBpw(3));
});

test("effectiveCapability: 7B@Q4 beats 1.5B@Q8 (bigger-but-quantized wins)", () => {
  const m15 = SEED_CATALOG.find((m) => m.id === "qwen2.5-1.5b-instruct")!;
  const q4: QuantSpec = { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, qualityRetention: 0.978 };
  const q8: QuantSpec = { family: "gguf", id: "Q8_0", bitsPerWeight: 8.5, qualityRetention: 0.999 };
  assert.ok(effectiveCapability(model7b, q4) > effectiveCapability(m15, q8));
});

test("tokensPerSec: smaller model is faster; bandwidth-bound scaling", () => {
  const q: QuantSpec = { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, qualityRetention: 0.978 };
  const m15 = SEED_CATALOG.find((m) => m.id === "qwen2.5-1.5b-instruct")!;
  const d = mkDevice();
  assert.ok(tokensPerSecEstimate(m15, q, d, "metal") > tokensPerSecEstimate(model7b, q, d, "metal"));
});

test("planner: balanced goal does NOT pick sub-4bit when memory is ample", () => {
  const r = plan({ device: mkDevice(), catalog: SEED_CATALOG, preference: { goal: "balanced" } });
  assert.ok(r.best, "should produce a plan");
  // With 12.8 GiB usable, balanced must not default to a 2-bit quant.
  assert.ok(r.best!.quant.bitsPerWeight >= 4, `expected >=4bpw, got ${r.best!.quant.id}`);
});

test("planner: tiny device falls back to a small model, never OOMs", () => {
  const tiny = mkDevice({
    totalRamBytes: 4 * GiB,
    usableRamBytes: 1.8 * GiB,
    thermallyConstrained: true,
    memoryBandwidthGBs: 60,
    accelerators: [{ kind: "cpu", name: "phone", memoryBytes: 4 * GiB, unifiedMemory: true, available: true }],
  });
  const r = plan({ device: tiny, catalog: SEED_CATALOG, preference: { goal: "balanced" } });
  assert.ok(r.best, "must still find SOMETHING runnable");
  assert.ok(r.best!.predicted.memoryPressure <= 0.8, "must respect memory ceiling");
  assert.ok(r.best!.model.paramsB <= 3.5, "tiny device should pick a small model");
});

test("planner: speed goal beats quality goal on tok/s", () => {
  const d = mkDevice();
  const speed = plan({ device: d, catalog: SEED_CATALOG, preference: { goal: "speed" } }).best!;
  const quality = plan({ device: d, catalog: SEED_CATALOG, preference: { goal: "quality" } }).best!;
  assert.ok(speed.predicted.tokensPerSecEstimate >= quality.predicted.tokensPerSecEstimate);
});

test("planner: quality goal retains >=95% quality on a capable device", () => {
  const q = plan({ device: mkDevice(), catalog: SEED_CATALOG, preference: { goal: "quality" } }).best!;
  assert.ok(q.predicted.qualityRetention >= 0.95);
});

test("planner: every returned plan fits under the pressure ceiling", () => {
  const r = plan({ device: mkDevice(), catalog: SEED_CATALOG, preference: { maxMemoryPressure: 0.8 } });
  for (const p of [r.best, ...r.alternatives]) {
    if (!p) continue;
    assert.ok(p.predicted.memoryPressure <= 0.8, `${p.model.id} exceeds ceiling`);
  }
});

// --- Decode-cliff honesty tests (plan b) -----------------------------------

test("cliff: weights over fast-memory ceiling collapse tok/s to the flash floor", () => {
  const q: QuantSpec = { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, qualityRetention: 0.978 };
  const d = mkDevice();
  // 7B weights ~4.3 GiB. Pretend the backend can only hold 2 GiB fast → over cliff.
  const onCliff = tokensPerSecEstimate(model7b, q, d, "metal", {
    footprintBytes: 5 * GiB,
    fastMemoryBytes: 2 * GiB,
  });
  const inRam = tokensPerSecEstimate(model7b, q, d, "metal", {
    footprintBytes: 5 * GiB,
    fastMemoryBytes: 12 * GiB,
  });
  assert.ok(onCliff < 1.0, `over-cliff should be <1 tok/s, got ${onCliff}`);
  assert.ok(inRam > onCliff * 10, `in-RAM should be >>10x faster (got ${inRam} vs ${onCliff})`);
});

test("cliff: thrash zone (weights fit, footprint spills) derates but doesn't floor", () => {
  const q: QuantSpec = { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, qualityRetention: 0.978 };
  const d = mkDevice();
  const w = weightBytes(model7b, q);
  // fast mem just above weights but below weights+kv+overhead → thrash
  const thrash = tokensPerSecEstimate(model7b, q, d, "metal", {
    footprintBytes: w + 2 * GiB,
    fastMemoryBytes: w + 0.3 * GiB,
  });
  const comfy = tokensPerSecEstimate(model7b, q, d, "metal", {
    footprintBytes: w + 2 * GiB,
    fastMemoryBytes: w + 4 * GiB,
  });
  assert.ok(thrash < comfy, "thrash must be slower than comfortable");
  assert.ok(thrash > 1.0, "thrash is a derate, not the flash floor");
});

test("planner: never returns a plan that thrashes or falls off the cliff", () => {
  // A device whose usable RAM can hold a 7B's weights but NOT with full context
  // working set — the old planner might ship it; the new one must downgrade.
  const squeezed = mkDevice({
    totalRamBytes: 8 * GiB,
    usableRamBytes: 5 * GiB, // 7B Q4 weights ~4.3 GiB → footprint spills
    memoryBandwidthGBs: 100,
  });
  const r = plan({ device: squeezed, catalog: SEED_CATALOG, preference: { goal: "quality" } });
  assert.ok(r.best, "must still find something runnable");
  assert.ok(
    r.best!.predicted.fitClass === "comfortable" || r.best!.predicted.fitClass === "tight",
    `best must not thrash/cliff, got ${r.best!.predicted.fitClass}`,
  );
  for (const p of [r.best, ...r.alternatives]) {
    if (!p) continue;
    assert.ok(
      p.predicted.fitClass !== "over-cliff" && p.predicted.fitClass !== "thrash",
      `${p.model.id} returned with bad fitClass ${p.predicted.fitClass}`,
    );
  }
});

test("planner: every returned plan carries an honest fitClass", () => {
  const r = plan({ device: mkDevice(), catalog: SEED_CATALOG, preference: { goal: "balanced" } });
  for (const p of [r.best, ...r.alternatives]) {
    if (!p) continue;
    assert.ok(
      ["comfortable", "tight"].includes(p.predicted.fitClass),
      `returned plan must be comfortable/tight, got ${p.predicted.fitClass}`,
    );
  }
});

// --- Jetsam profiler honesty tests (plan b) --------------------------------

test("jetsam: usable RAM is a TIERED budget, shrinking as a fraction of total", () => {
  // 4GB phone → ~1.7 GiB; 8GB → ~3.8 GiB. Fraction must DECREASE with size —
  // that's the whole correction over a flat multiplier.
  const u4 = estimateUsableRam(4 * GiB, true, "ios");
  const u8 = estimateUsableRam(8 * GiB, true, "ios");
  const u16 = estimateUsableRam(16 * GiB, true, "ios");
  const frac4 = u4 / (4 * GiB);
  const frac8 = u8 / (8 * GiB);
  const frac16 = u16 / (16 * GiB);
  assert.ok(frac4 > frac8 && frac8 > frac16, "per-app budget fraction must shrink as RAM grows");
});

test("jetsam: a 6GB iPhone is capped well below nameplate (the headline correction)", () => {
  const u6 = estimateUsableRam(6 * GiB, true, "ios") / GiB;
  // Must be in the realistic jetsam band (~2-3 GiB), NOT 0.45*6=2.7 by luck of
  // a flat multiplier and NOT anywhere near 6.
  assert.ok(u6 >= 2.0 && u6 <= 3.2, `6GB iPhone usable should be ~2-3 GiB, got ${u6.toFixed(2)}`);
});

test("jetsam: iOS budget <= Android at same RAM (jetsam is the harder wall)", () => {
  const ios = estimateUsableRam(8 * GiB, true, "ios");
  const android = estimateUsableRam(8 * GiB, true, "android");
  assert.ok(ios <= android, "iOS jetsam should be no more generous than Android LMK");
});

test("jetsam: desktop path unchanged — reserves system RAM, not a phone budget", () => {
  const desk = estimateUsableRam(16 * GiB, false, "macos") / GiB;
  assert.ok(desk >= 12 && desk <= 13.5, `16GB Mac should expose ~12.8 GiB, got ${desk.toFixed(2)}`);
});
