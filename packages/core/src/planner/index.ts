/**
 * The Planner — LocAI's moat.
 *
 * Given a DeviceProfile + a model catalog + a preference, it enumerates every
 * (model, quant) candidate, prices it out (memory, speed, quality), filters the
 * ones that won't fit safely, scores the survivors, and returns the best
 * RunPlan with a human-readable rationale and a confidence.
 *
 * This is deterministic and pure — same inputs => same plan. Fully testable.
 */

import type {
  PlanRequest,
  RunPlan,
  ModelDescriptor,
  QuantSpec,
  DeviceProfile,
  BackendKind,
} from "../types.ts";
import {
  totalRuntimeBytes,
  tokensPerSecEstimate,
  kvCacheBytes,
  weightBytes,
} from "./resource.ts";
import { effectiveCapability } from "./quality.ts";
import {
  chooseBackend,
  chooseKvCacheType,
  chooseThreads,
  chooseGpuLayers,
  shouldSpeculate,
} from "./backend.ts";

interface Candidate {
  model: ModelDescriptor;
  quant: QuantSpec;
  plan: RunPlan;
}

const DEFAULT_MAX_PRESSURE = 0.8;
const MIN_USABLE_TPS = 2.0; // below this, generation feels broken

/**
 * Fast memory available to the chosen backend, in bytes — the ceiling weights
 * must fit under to avoid the decode cliff.
 *
 *  - Discrete GPU (cuda/rocm/vulkan/sycl with its own VRAM): the card's VRAM.
 *    Spilling past VRAM means streaming weights over PCIe each token → cliff.
 *  - Unified memory (Apple metal) or CPU: the device's usable RAM budget.
 *
 * This is what makes "fits and stays fast" a checkable claim instead of a hope.
 */
function fastMemoryBytes(
  device: DeviceProfile,
  backend: BackendKind,
  accelerator: { memoryBytes?: number; unifiedMemory?: boolean },
): number {
  if (backend === "cpu") return device.usableRamBytes;
  if (accelerator.unifiedMemory) return device.usableRamBytes;
  // Discrete VRAM. Reserve ~10% for the framework/context on the card.
  if (accelerator.memoryBytes && accelerator.memoryBytes > 0) {
    return Math.floor(accelerator.memoryBytes * 0.9);
  }
  // Unknown discrete VRAM → fall back to usable RAM (conservative).
  return device.usableRamBytes;
}

function classifyFit(
  weights: number,
  footprint: number,
  fast: number,
): "comfortable" | "tight" | "thrash" | "over-cliff" {
  if (weights > fast) return "over-cliff";
  if (footprint > fast) return "thrash";
  if (footprint > fast * 0.85) return "tight";
  return "comfortable";
}

/**
 * Build a RunPlan for one (model, quant) on this device, or null if infeasible.
 */
function buildPlan(
  device: DeviceProfile,
  model: ModelDescriptor,
  quant: QuantSpec,
  pref: PlanRequest["preference"],
): RunPlan | null {
  // 1. Pick a backend that can run this quant family on this device.
  const backendChoice = chooseBackend(device, quant.family);
  if (!backendChoice) return null;
  const { backend, accelerator } = backendChoice;

  // 2. Determine context length.
  // If the caller specified a minimum, honour it (capped to model max).
  // Otherwise use the model's full context length — don't silently cap it.
  // The KV-cache sizing below will handle memory pressure automatically.
  const wantContext = pref?.minContext && pref.minContext > 0
    ? pref.minContext
    : model.contextLength;
  const contextLength = Math.min(wantContext, model.contextLength);

  // 3. Size memory at f16 KV first, then downgrade KV type under pressure.
  const usable = device.usableRamBytes;
  const f16 = totalRuntimeBytes(model, quant, contextLength, "f16");
  const pressureF16 = f16.total / usable;
  const kvType = chooseKvCacheType(pressureF16);
  const sized = totalRuntimeBytes(model, quant, contextLength, kvType);
  const memoryPressure = sized.total / usable;

  const maxPressure = pref?.maxMemoryPressure ?? DEFAULT_MAX_PRESSURE;

  // 4. Hard feasibility gate: must fit under the pressure ceiling.
  if (memoryPressure > maxPressure) return null;

  // 4b. DECODE-CLIFF GATE — the honesty fix.
  //
  // memoryPressure is measured against usable RAM, but the thing that actually
  // determines whether decode stays fast is whether the working set fits in the
  // BACKEND'S fast memory (VRAM for discrete GPUs; usable RAM for unified/CPU).
  // Classify the fit and refuse to ship a plan that would thrash or fall off
  // the cliff — better to auto-downgrade to a smaller model/quant than to hand
  // the user a 0.3 tok/s experience that "technically fit."
  const fast = fastMemoryBytes(device, backend, accelerator);
  const fitClass = classifyFit(sized.weights, sized.total, fast);
  if (fitClass === "over-cliff" || fitClass === "thrash") return null;

  // 5. Predict speed — now cliff-aware (passes footprint + fast-memory ceiling).
  const tps = tokensPerSecEstimate(model, quant, device, backend, {
    footprintBytes: sized.total,
    fastMemoryBytes: fast,
  });
  if (tps < MIN_USABLE_TPS) return null;

  // 6. Quality.
  const capability = effectiveCapability(model, quant);
  const qualityRetention =
    quant.qualityRetention ?? capability / Math.max(0.001, model.baseCapability);

  // 7. Runtime params.
  const gpuLayers = chooseGpuLayers(backend, accelerator, model, sized.weights);
  const threads = chooseThreads(device);
  const speculative = shouldSpeculate(model, memoryPressure, device);

  // 8. Composite score: weighted by user goal.
  const goal = pref?.goal ?? "balanced";
  // Fit is a SATURATING SAFETY term, not a "reward empty RAM" term. Below the
  // cliff, more headroom barely matters — a comfortable 58%-pressure plan is not
  // meaningfully riskier than a 26% one, and treating it as such sabotages the
  // core thesis (a bigger model that still fits should win on quality). So we
  // give near-full fit credit while comfortable and only punish as the working
  // set approaches the fast-memory ceiling (tight → thrash).
  //   headroom = how far the footprint is below the fast-memory ceiling.
  const headroom = Math.max(0, 1 - sized.total / fast); // 0..1
  // Map headroom through a curve that saturates: ≥30% headroom ≈ full credit.
  const fit = Math.min(1, headroom / 0.3);
  const speedNorm = Math.min(1, tps / 40); // 40 tok/s ~= "fast" ceiling
  const weights =
    goal === "quality"
      ? { q: 0.6, s: 0.15, f: 0.25 }
      : goal === "speed"
        ? { q: 0.25, s: 0.5, f: 0.25 }
        : { q: 0.45, s: 0.3, f: 0.25 };
  let score = weights.q * capability + weights.s * speedNorm + weights.f * fit;

  // 8b. "Don't waste headroom on aggressive quant" penalty.
  //
  // If we picked a low-bit quant (<4 bpw) but the device has ample memory to
  // afford a higher-bit version of THE SAME model, that's a quality trap: the
  // user gives up accuracy for headroom they didn't need. Penalize it so the
  // planner prefers the higher-bit variant unless memory actually forces the
  // compression. This is the core anti-"opaque-quant" correction.
  if (quant.bitsPerWeight < 4 && memoryPressure < 0.5) {
    // The lower the bpw and the more spare memory, the bigger the penalty.
    const wastedHeadroom = 0.5 - memoryPressure; // 0..0.5
    const aggressiveness = (4 - quant.bitsPerWeight) / 4; // 0..1
    score -= wastedHeadroom * aggressiveness * 0.6;
  }

  // 9. Confidence it won't OOM/thermal-kill.
  let confidence = 1 - memoryPressure * 0.6;
  if (device.thermallyConstrained && model.paramsB > 4) confidence -= 0.15;
  if (memoryPressure > 0.7) confidence -= 0.1;
  confidence = Math.max(0.05, Math.min(0.99, confidence));

  // 10. Rationale — the transparency that builds trust.
  const rationale: string[] = [];
  rationale.push(
    `Selected ${model.displayName} (${model.paramsB}B) at ${quant.id} (${quant.bitsPerWeight.toFixed(1)} bpw${quant.imatrix ? ", imatrix" : ""}).`,
  );
  rationale.push(backendChoice.rationale + ".");
  rationale.push(
    `Fits in ${fmtGiB(sized.total)} of ${fmtGiB(usable)} usable RAM (${(memoryPressure * 100).toFixed(0)}% pressure).`,
  );
  if (kvType !== "f16")
    rationale.push(`KV cache quantized to ${kvType} to fit the chosen context (${contextLength} tokens).`);
  if (model.gqa) rationale.push("Model uses grouped-query attention → compact KV cache.");
  rationale.push(`Estimated ~${tps.toFixed(0)} tokens/sec decode.`);
  if (fitClass === "tight")
    rationale.push(
      "Working set is near the fast-memory ceiling — context growth is constrained to stay off the paging cliff.",
    );
  else
    rationale.push("Weights + KV cache fit in fast memory with headroom — decode stays bandwidth-bound (no flash paging).");
  rationale.push(`Quality retention ~${(qualityRetention * 100).toFixed(0)}% vs full precision.`);
  if (speculative) rationale.push("Speculative decoding enabled (memory headroom available).");

  return {
    model,
    quant,
    backend,
    params: { contextLength, kvCacheType: kvType, gpuLayers, threads, speculative },
    predicted: {
      weightsBytes: sized.weights,
      kvCacheBytes: sized.kv,
      totalRuntimeBytes: sized.total,
      memoryPressure,
      tokensPerSecEstimate: tps,
      score,
      qualityRetention,
      fitClass,
    },
    rationale,
    confidence,
  };
}

/**
 * THE entry point. Returns the best plan, plus ranked alternatives.
 */
export function plan(req: PlanRequest): {
  best: RunPlan | null;
  alternatives: RunPlan[];
  rejected: number;
} {
  const { device, catalog, preference } = req;
  const candidates: Candidate[] = [];
  let rejected = 0;

  const modality = preference?.modality ?? "text";

  for (const model of catalog) {
    if (!model.modalities.includes(modality)) continue;
    for (const quant of model.quants) {
      const p = buildPlan(device, model, quant, preference);
      if (p) candidates.push({ model, quant, plan: p });
      else rejected++;
    }
  }

  candidates.sort((a, b) => b.plan.predicted.score - a.plan.predicted.score);

  // Deduplicate alternatives to one-per-model so the user sees variety.
  const seen = new Set<string>();
  const ranked: RunPlan[] = [];
  for (const c of candidates) {
    if (seen.has(c.model.id)) continue;
    seen.add(c.model.id);
    ranked.push(c.plan);
  }

  return {
    best: ranked[0] ?? null,
    alternatives: ranked.slice(1, 5),
    rejected,
  };
}

// ---------------------------------------------------------------------------

function fmtGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1) + " GiB";
}

export { weightBytes, kvCacheBytes };
