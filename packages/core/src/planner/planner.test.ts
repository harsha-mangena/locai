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
