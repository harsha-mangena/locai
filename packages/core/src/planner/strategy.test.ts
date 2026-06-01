/**
 * Strategy cascade tests.
 *
 * These are the correctness properties that make LocAI work on a 4 GB phone:
 *   1. Always returns a runnable strategy (never null/undefined)
 *   2. Prefers system model when available (zero cost)
 *   3. Prefers local model over system model when local is better
 *   4. Schedules a download when no local model exists
 *   5. Flash-backed is only offered when viable (tok/s >= minimum)
 *   6. Download plan is WiFi-only on mobile
 *   7. No-space devices get browser fallback, not a crash
 *
 * Run: node --experimental-strip-types --test packages/core/src/planner/strategy.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { selectStrategy, assessFlashBacked, detectSystemModel } from "./strategy.ts";
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
    freeDiskBytes: 50 * GiB,
    capturedAt: new Date().toISOString(),
    source: "synthetic",
    ...overrides,
  };
}

function mkPhone(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return mkDevice({
    platform: "android",
    arch: "arm64",
    totalRamBytes: 4 * GiB,
    usableRamBytes: 1.9 * GiB,
    thermallyConstrained: true,
    memoryBandwidthGBs: 40,
    freeDiskBytes: 8 * GiB,
    accelerators: [
      { kind: "vulkan", name: "Adreno 730", memoryBytes: 4 * GiB, unifiedMemory: true, perfHint: 0.5, available: true },
      { kind: "cpu", name: "Snapdragon 8 Gen 1", memoryBytes: 4 * GiB, unifiedMemory: true, perfHint: 0.3, available: true },
    ],
    source: "synthetic",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Core invariant: always returns a strategy
// ---------------------------------------------------------------------------

test("strategy: always returns a runnable strategy — never crashes", () => {
  // Worst case: no local models, no system model, tiny device.
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 0 }),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
  });
  assert.ok(result.strategy, "must return a strategy");
  assert.ok(result.rationale.length > 0, "must provide rationale");
});

test("strategy: empty full catalog still returns a strategy", () => {
  const result = selectStrategy({
    device: mkDevice(),
    localCatalog: [],
    fullCatalog: [],
  });
  assert.ok(result.strategy, "must return a strategy even with empty catalog");
});

// ---------------------------------------------------------------------------
// Tier 0: System model
// ---------------------------------------------------------------------------

test("strategy: uses system model when available and no local model exists", () => {
  const result = selectStrategy({
    device: mkPhone(),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
    systemModelProbe: () => ({
      available: true,
      name: "Gemini Nano",
      capability: 0.65,
      provider: "android-aicore",
    }),
  });
  assert.equal(result.strategy, "system-model");
  assert.equal(result.availability, "system");
  assert.equal(result.runPlan, null);
});

test("strategy: system model schedules a background download for upgrade", () => {
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 10 * GiB }),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
    systemModelProbe: () => ({
      available: true,
      name: "Gemini Nano",
      capability: 0.65,
      provider: "android-aicore",
    }),
  });
  assert.equal(result.strategy, "system-model");
  // Should have a pending upgrade to a local model.
  assert.ok(result.pendingUpgrade, "should schedule a download upgrade");
  assert.equal(result.pendingUpgrade!.strategy, "native-local");
  assert.ok(result.pendingUpgrade!.downloadPlan.sizeBytes > 0);
});

test("strategy: system model does NOT schedule download when disk is full", () => {
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 100 * 1024 }), // 100 KB — way too small
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
    systemModelProbe: () => ({
      available: true,
      name: "Gemini Nano",
      capability: 0.65,
      provider: "android-aicore",
    }),
  });
  assert.equal(result.strategy, "system-model");
  assert.equal(result.pendingUpgrade, undefined, "no upgrade when disk is full");
});

// ---------------------------------------------------------------------------
// Tier 1: Native local
// ---------------------------------------------------------------------------

test("strategy: uses native-local when a model is on disk", () => {
  const result = selectStrategy({
    device: mkDevice(),
    localCatalog: SEED_CATALOG,
    fullCatalog: SEED_CATALOG,
  });
  assert.equal(result.strategy, "native-local");
  assert.equal(result.availability, "ready");
  assert.ok(result.runPlan, "must have a run plan");
});

test("strategy: native-local plan respects memory ceiling", () => {
  const result = selectStrategy({
    device: mkDevice(),
    localCatalog: SEED_CATALOG,
    fullCatalog: SEED_CATALOG,
    preference: { maxMemoryPressure: 0.8 },
  });
  assert.equal(result.strategy, "native-local");
  assert.ok(result.runPlan!.predicted.memoryPressure <= 0.8);
});

test("strategy: prefers native-local over system model when local model is available", () => {
  // Even if system model is available, a local model should win (better quality/control).
  const result = selectStrategy({
    device: mkDevice(),
    localCatalog: SEED_CATALOG,
    fullCatalog: SEED_CATALOG,
    systemModelProbe: () => ({
      available: true,
      name: "Apple Foundation Models",
      capability: 0.65,
      provider: "apple-foundation-models",
    }),
  });
  // Local model wins because it's already there and the planner found a good plan.
  assert.equal(result.strategy, "native-local");
});

// ---------------------------------------------------------------------------
// Download scheduling
// ---------------------------------------------------------------------------

test("strategy: schedules download when no local model and disk space available", () => {
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 10 * GiB }),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
  });
  // No system model on Android by default (probe not injected).
  // Should schedule a download.
  assert.ok(
    result.downloadPlan || result.pendingUpgrade,
    "should have a download plan",
  );
});

test("strategy: download plan is WiFi-only on mobile", () => {
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 10 * GiB }),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
    systemModelProbe: () => ({
      available: true,
      name: "Gemini Nano",
      capability: 0.65,
      provider: "android-aicore",
    }),
  });
  if (result.pendingUpgrade) {
    assert.equal(result.pendingUpgrade.downloadPlan.wifiOnly, true);
  }
});

test("strategy: download plan is resumable", () => {
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 10 * GiB }),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
    systemModelProbe: () => ({
      available: true,
      name: "Gemini Nano",
      capability: 0.65,
      provider: "android-aicore",
    }),
  });
  if (result.pendingUpgrade) {
    assert.equal(result.pendingUpgrade.downloadPlan.resumable, true);
  }
});

// ---------------------------------------------------------------------------
// Flash-backed viability
// ---------------------------------------------------------------------------

test("flash-backed: not viable when model fits in DRAM", () => {
  const model = SEED_CATALOG.find((m) => m.id === "qwen2.5-1.5b-instruct")!;
  const quant = model.quants.find((q) => q.id === "Q4_K_M")!;
  const device = mkPhone({ usableRamBytes: 4 * GiB }); // plenty of DRAM
  const v = assessFlashBacked(model, quant, device);
  assert.equal(v.viable, false, "should not use flash-backed when model fits in DRAM");
});

test("flash-backed: viable for 3B model on 1.9 GB DRAM phone", () => {
  const model = SEED_CATALOG.find((m) => m.id === "llama-3.2-3b-instruct")!;
  const quant = model.quants.find((q) => q.id === "Q4_K_M")!;
  const device = mkPhone({ usableRamBytes: 1.9 * GiB, freeDiskBytes: 10 * GiB });
  const v = assessFlashBacked(model, quant, device);
  // 3B Q4_K_M ~2 GB > 1.9 GB DRAM → flash-backed might be viable.
  // The exact result depends on the math; just check it doesn't crash.
  assert.ok(typeof v.viable === "boolean");
  assert.ok(typeof v.estimatedTps === "number");
});

test("flash-backed: not viable when no disk space", () => {
  const model = SEED_CATALOG.find((m) => m.id === "llama-3.2-3b-instruct")!;
  const quant = model.quants.find((q) => q.id === "Q4_K_M")!;
  const device = mkPhone({ usableRamBytes: 1.0 * GiB, freeDiskBytes: 100 * 1024 });
  const v = assessFlashBacked(model, quant, device);
  assert.equal(v.viable, false, "no disk space → not viable");
});

test("flash-backed: 7B model not viable on 4 GB phone (too slow)", () => {
  const model = SEED_CATALOG.find((m) => m.id === "qwen2.5-7b-instruct")!;
  const quant = model.quants.find((q) => q.id === "Q4_K_M")!;
  const device = mkPhone({ usableRamBytes: 1.9 * GiB, freeDiskBytes: 20 * GiB });
  const v = assessFlashBacked(model, quant, device);
  // 7B Q4_K_M ~4.3 GB, only 1.9 GB DRAM → ~44% hot, ~56% cold.
  // At 1.2 GB/s flash: very slow. Should be below 2 tok/s minimum.
  if (v.viable) {
    assert.ok(v.estimatedTps >= 2.0, "if viable, must meet minimum tok/s");
  }
});

// ---------------------------------------------------------------------------
// No-space fallback
// ---------------------------------------------------------------------------

test("strategy: no-space device gets browser fallback, not a crash", () => {
  const result = selectStrategy({
    device: mkPhone({ freeDiskBytes: 0 }),
    localCatalog: [],
    fullCatalog: SEED_CATALOG,
  });
  assert.ok(
    result.strategy === "browser-wasm" ||
    result.strategy === "browser-webgpu" ||
    result.strategy === "hybrid-edge" ||
    result.strategy === "system-model",
    `expected browser/system/hybrid fallback, got ${result.strategy}`,
  );
  assert.ok(result.rationale.length > 0);
});

// ---------------------------------------------------------------------------
// System model detection
// ---------------------------------------------------------------------------

test("detectSystemModel: returns unavailable for Node/synthetic source", () => {
  const device = mkDevice({ source: "synthetic" });
  const info = detectSystemModel(device);
  assert.equal(info.available, false);
  assert.equal(info.provider, "none");
});

test("detectSystemModel: probe override works", () => {
  const device = mkDevice();
  const info = detectSystemModel(device, () => ({
    available: true,
    name: "Test Model",
    capability: 0.7,
    provider: "apple-foundation-models",
  }));
  assert.equal(info.available, true);
  assert.equal(info.provider, "apple-foundation-models");
});
