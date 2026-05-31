/**
 * Resource estimation — the physics of the planner.
 *
 * Every function here is an ATOMIC, independently-testable claim about how much
 * memory a model needs and how fast it will run. The planner composes them.
 *
 * Sources/priors come from our research teardown (GGUF k/i-quants + imatrix,
 * KV-cache quantization, GQA, memory-bandwidth-bound decode).
 */

import type { ModelDescriptor, QuantSpec, DeviceProfile, BackendKind } from "../types.ts";

const GiB = 1024 ** 3;

/**
 * Weight memory = params * bitsPerWeight / 8.
 * bpw already encodes the quant (e.g. Q4_K_M ~= 4.8 bpw effective incl. metadata).
 */
export function weightBytes(model: ModelDescriptor, quant: QuantSpec): number {
  const paramCount = model.paramsB * 1e9;
  return Math.round((paramCount * quant.bitsPerWeight) / 8);
}

/**
 * KV-cache memory.
 *
 *   bytes = 2 (K and V)
 *         * numLayers
 *         * numKVHeads * headDim   (= kv hidden size; GQA shrinks numKVHeads)
 *         * contextLength
 *         * bytesPerElement(kvType)
 *
 * GQA is the single biggest on-device memory lever after weight quant: with
 * 8 KV heads vs 32 query heads the cache is 4x smaller.
 */
export function kvCacheBytes(
  model: ModelDescriptor,
  contextLength: number,
  kvType: "f16" | "q8_0" | "q4_0",
): number {
  const layers = model.numLayers ?? estimateLayers(model.paramsB);
  const hidden = model.hiddenSize ?? estimateHidden(model.paramsB);
  const heads = model.numAttentionHeads ?? Math.max(1, Math.round(hidden / 128));
  const headDim = hidden / heads;
  const kvHeads = model.numKeyValueHeads ?? (model.gqa ? Math.max(1, Math.round(heads / 4)) : heads);

  const bytesPerElem = kvType === "f16" ? 2 : kvType === "q8_0" ? 1 : 0.5;
  const kvHidden = kvHeads * headDim;
  return Math.round(2 * layers * kvHidden * contextLength * bytesPerElem);
}

/** Compute/activation overhead + framework headroom. Coarse but conservative. */
export function runtimeOverheadBytes(weights: number): number {
  // ~10% of weights for activations/scratch + a fixed framework floor.
  return Math.round(weights * 0.1) + 256 * 1024 * 1024;
}

export function totalRuntimeBytes(
  model: ModelDescriptor,
  quant: QuantSpec,
  contextLength: number,
  kvType: "f16" | "q8_0" | "q4_0",
): { weights: number; kv: number; overhead: number; total: number } {
  const weights = weightBytes(model, quant);
  const kv = kvCacheBytes(model, contextLength, kvType);
  const overhead = runtimeOverheadBytes(weights);
  return { weights, kv, overhead, total: weights + kv + overhead };
}

/**
 * Decode speed estimate (tokens/sec).
 *
 * Decode is memory-BANDWIDTH-bound: each token streams ~all weights once.
 *   tok/s ≈ (effectiveBandwidthGBs * 1e9 * efficiency) / weightBytes
 *
 * We apply a backend efficiency factor and a thermal derate.
 */
export function tokensPerSecEstimate(
  model: ModelDescriptor,
  quant: QuantSpec,
  device: DeviceProfile,
  backend: BackendKind,
): number {
  const weights = weightBytes(model, quant);
  if (weights <= 0) return 0;

  // Effective bandwidth: prefer the accelerator's, fall back to CPU prior.
  let bandwidthGBs = device.memoryBandwidthGBs ?? cpuBandwidthPrior(device);

  // Backend efficiency: how much of peak bandwidth the kernels realize.
  const eff: Partial<Record<BackendKind, number>> = {
    cuda: 0.75,
    metal: 0.65,
    rocm: 0.6,
    vulkan: 0.5,
    sycl: 0.45,
    cpu: 0.55, // CPU realizes a high fraction of its (low) bandwidth
    webgpu: 0.35,
    wasm: 0.15,
    coreml: 0.4,
    qnn: 0.5,
    openvino: 0.45,
  };
  const efficiency = eff[backend] ?? 0.4;

  // CPU-only inference is bound by CPU memory bandwidth, which is lower than GPU.
  if (backend === "cpu") bandwidthGBs = cpuBandwidthPrior(device);

  let tps = (bandwidthGBs * 1e9 * efficiency) / weights;

  // Thermal derate for sustained generation on constrained devices.
  if (device.thermallyConstrained) tps *= 0.55;

  // Sub-4-bit i-quants have slower kernels (codebook lookups) — small penalty.
  if (quant.bitsPerWeight < 4 && quant.family === "gguf") tps *= 0.85;

  return Math.max(0.1, Math.round(tps * 10) / 10);
}

function cpuBandwidthPrior(device: DeviceProfile): number {
  // Apple Silicon CPU can use much of the unified bandwidth; x86 desktop DDR5
  // ~ 50-80 GB/s; laptop DDR ~ 30-50.
  if (device.platform === "macos" && device.arch === "arm64") {
    return Math.min(device.memoryBandwidthGBs ?? 100, 120);
  }
  return device.arch === "x64" ? 50 : 40;
}

// ---------------------------------------------------------------------------
// Architecture estimators (used when a model omits explicit dims)
// ---------------------------------------------------------------------------

export function estimateLayers(paramsB: number): number {
  if (paramsB <= 1.5) return 24;
  if (paramsB <= 4) return 28;
  if (paramsB <= 9) return 32;
  if (paramsB <= 15) return 40;
  if (paramsB <= 35) return 48;
  return 80;
}

export function estimateHidden(paramsB: number): number {
  if (paramsB <= 1.5) return 1536;
  if (paramsB <= 4) return 2560;
  if (paramsB <= 9) return 4096;
  if (paramsB <= 15) return 5120;
  if (paramsB <= 35) return 6656;
  return 8192;
}

export { GiB };
