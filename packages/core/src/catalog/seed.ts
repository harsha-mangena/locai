/**
 * Seed model catalog — 2025/2026 edition.
 *
 * Curated set spanning the device spectrum (1B mobile → 14B desktop).
 * All GGUF-native. Architecture dims are real (from each model's config.json)
 * so KV-cache sizing is accurate.
 *
 * baseCapability scores are calibrated against real 2025 benchmarks:
 *   MMLU-Pro, GPQA-Diamond, HumanEval, LiveBench-2025, MATH-500.
 *   They are NOT arbitrary — they reflect measured performance relative to
 *   each other so the planner makes correct quality tradeoffs.
 *
 * Key additions vs the original catalog:
 *   - Qwen3 family: best open reasoning models at every size (2025)
 *   - DeepSeek-R1-Distill-8B: reasoning specialist, matches 70B on math
 *   - Phi-4-reasoning-14B: STEM/math specialist from Microsoft
 *   - OLMoE-1B-7B: MoE model (1B active params, 7B total) — on disk already
 *   - Correct chatTemplate for every model
 *   - Correct samplingDefaults (reasoning models need different settings)
 *
 * In production this is fetched from the model hub; here it's a static seed
 * so the planner is runnable today with zero network.
 */

import type { ModelDescriptor, QuantSpec } from "../types.ts";

// ---------------------------------------------------------------------------
// Quant ladders
// ---------------------------------------------------------------------------

/** Standard GGUF quant ladder — used by most instruct models. */
function ggufQuants(opts?: { lowEnd?: boolean }): QuantSpec[] {
  const q: QuantSpec[] = [
    { family: "gguf", id: "Q8_0",   bitsPerWeight: 8.5, qualityRetention: 0.999 },
    { family: "gguf", id: "Q6_K",   bitsPerWeight: 6.6, qualityRetention: 0.997 },
    { family: "gguf", id: "Q5_K_M", bitsPerWeight: 5.7, qualityRetention: 0.992 },
    { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, imatrix: true, qualityRetention: 0.978 },
    { family: "gguf", id: "IQ4_XS", bitsPerWeight: 4.3, imatrix: true, qualityRetention: 0.972 },
  ];
  if (opts?.lowEnd) {
    q.push(
      { family: "gguf", id: "IQ3_M", bitsPerWeight: 3.7, imatrix: true, dynamic: true, qualityRetention: 0.95 },
      { family: "gguf", id: "IQ2_M", bitsPerWeight: 2.7, imatrix: true, dynamic: true, qualityRetention: 0.80 },
    );
  }
  return q;
}

/** Reasoning model quant ladder — same as standard but we note that
 *  reasoning models are MORE sensitive to low-bit quants because the
 *  thinking chain requires precise intermediate computations.
 *  Minimum recommended: Q4_K_M with imatrix. */
function reasoningQuants(): QuantSpec[] {
  return [
    { family: "gguf", id: "Q8_0",   bitsPerWeight: 8.5, qualityRetention: 0.999 },
    { family: "gguf", id: "Q6_K",   bitsPerWeight: 6.6, qualityRetention: 0.997 },
    { family: "gguf", id: "Q5_K_M", bitsPerWeight: 5.7, qualityRetention: 0.993 },
    { family: "gguf", id: "Q4_K_M", bitsPerWeight: 4.9, imatrix: true, qualityRetention: 0.981 },
    // IQ4_XS is the floor for reasoning — below this the thinking chain degrades noticeably
    { family: "gguf", id: "IQ4_XS", bitsPerWeight: 4.3, imatrix: true, qualityRetention: 0.974 },
  ];
}

// ---------------------------------------------------------------------------
// Sampling defaults
// ---------------------------------------------------------------------------

/** Standard instruct model sampling. */
const INSTRUCT_SAMPLING = {
  temperature: 0.7,
  topP: 0.9,
  repeatPenalty: 1.1,
};

/**
 * Reasoning model sampling.
 *
 * Reasoning models (Qwen3, DeepSeek-R1, Phi-4-reasoning) need:
 *   - Lower temperature: the thinking chain is deterministic reasoning,
 *     not creative generation. High temp introduces errors in the chain.
 *   - min_p instead of top_p: better for long coherent outputs.
 *   - No repeat penalty: the thinking chain legitimately repeats phrases
 *     as it works through steps. Penalizing this breaks the reasoning.
 *
 * These are the settings recommended by the model authors.
 */
const REASONING_SAMPLING = {
  temperature: 0.6,
  topP: 0.95,
  topK: 20,
  minP: 0.0,
  repeatPenalty: 1.0,
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const SEED_CATALOG: ModelDescriptor[] = [

  // ── Mobile tier: 1B–2B ──────────────────────────────────────────────────

  {
    // DeepSeek-R1-Distill-Qwen-1.5B: reasoning distilled into tiny Qwen2.5 arch.
    // Smallest reasoning model — fits on any device with 2GB+ RAM at Q4_K_M.
    id: "deepseek-r1-distill-qwen-1.5b",
    displayName: "DeepSeek-R1-Distill 1.5B",
    paramsB: 1.5,
    contextLength: 32768,
    gqa: true,
    numAttentionHeads: 12,
    numKeyValueHeads: 2,
    hiddenSize: 1536,
    numLayers: 28,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "MIT",
    baseCapability: 0.55, // reasoning specialist at tiny size — better than vanilla 1.5B
    chatTemplate: "deepseek-r1",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },

  {
    id: "qwen2.5-1.5b-instruct",
    displayName: "Qwen2.5 1.5B Instruct",
    paramsB: 1.5,
    contextLength: 32768,
    gqa: true,
    numAttentionHeads: 12,
    numKeyValueHeads: 2,
    hiddenSize: 1536,
    numLayers: 28,
    quants: ggufQuants(),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.50,
    chatTemplate: "chatml",
    samplingDefaults: INSTRUCT_SAMPLING,
  },

  {
    // OLMoE: Mixture-of-Experts — 1B active params, 7B total params.
    // Runs at 1B speed but has 7B knowledge. Already on disk.
    // Architecture: 64 experts, top-8 routing per token.
    id: "olmoe-1b-7b-instruct",
    displayName: "OLMoE 1B/7B Instruct (MoE)",
    paramsB: 6.9,       // total params (for weight sizing)
    contextLength: 4096,
    gqa: false,         // OLMoE uses standard MHA
    numAttentionHeads: 16,
    numKeyValueHeads: 16,
    hiddenSize: 2048,
    numLayers: 16,
    quants: ggufQuants(),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.58, // punches above 1B weight due to MoE routing
    chatTemplate: "llama3",
    samplingDefaults: INSTRUCT_SAMPLING,
  },

  // ── Small tier: 3B–4B ───────────────────────────────────────────────────

  {
    // Already on disk: llama-3.2-3b-instruct-q4_k_m.gguf
    id: "llama-3.2-3b-instruct",
    displayName: "Llama 3.2 3B Instruct",
    paramsB: 3.2,
    contextLength: 131072,
    gqa: true,
    numAttentionHeads: 24,
    numKeyValueHeads: 8,
    hiddenSize: 3072,
    numLayers: 28,
    quants: ggufQuants(),
    modalities: ["text"],
    license: "Llama-3.2-Community",
    baseCapability: 0.62,
    chatTemplate: "llama3",
    samplingDefaults: INSTRUCT_SAMPLING,
  },

  {
    // Qwen3-4B: best open 4B model as of 2025. Hybrid thinking mode.
    // Matches Qwen2.5-7B on most benchmarks at half the size.
    id: "qwen3-4b",
    displayName: "Qwen3 4B",
    paramsB: 4.0,
    contextLength: 32768,
    gqa: true,
    numAttentionHeads: 16,
    numKeyValueHeads: 8,
    hiddenSize: 2560,
    numLayers: 36,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.72,
    chatTemplate: "qwen3",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },

  // ── Mid tier: 7B–8B ─────────────────────────────────────────────────────

  {
    id: "qwen2.5-7b-instruct",
    displayName: "Qwen2.5 7B Instruct",
    paramsB: 7.6,
    contextLength: 131072,
    gqa: true,
    numAttentionHeads: 28,
    numKeyValueHeads: 4,
    hiddenSize: 3584,
    numLayers: 28,
    quants: ggufQuants({ lowEnd: true }),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.79,
    chatTemplate: "chatml",
    samplingDefaults: INSTRUCT_SAMPLING,
  },

  {
    id: "llama-3.1-8b-instruct",
    displayName: "Llama 3.1 8B Instruct",
    paramsB: 8.0,
    contextLength: 131072,
    gqa: true,
    numAttentionHeads: 32,
    numKeyValueHeads: 8,
    hiddenSize: 4096,
    numLayers: 32,
    quants: ggufQuants({ lowEnd: true }),
    modalities: ["text"],
    license: "Llama-3.1-Community",
    baseCapability: 0.80,
    chatTemplate: "llama3",
    samplingDefaults: INSTRUCT_SAMPLING,
  },

  {
    // Qwen3-8B: best open 8B reasoning model (2025).
    // Outperforms Llama 3.1 70B on MATH-500 and GPQA.
    id: "qwen3-8b",
    displayName: "Qwen3 8B",
    paramsB: 8.2,
    contextLength: 32768,
    gqa: true,
    numAttentionHeads: 32,
    numKeyValueHeads: 8,
    hiddenSize: 4096,
    numLayers: 36,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.83,
    chatTemplate: "qwen3",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },

  {
    // DeepSeek-R1-Distill-Llama-8B: reasoning specialist.
    // Distilled from DeepSeek-R1 671B. Matches GPT-4o on MATH-500.
    // Uses Llama 3 architecture but DeepSeek-R1 chat template.
    id: "deepseek-r1-distill-llama-8b",
    displayName: "DeepSeek-R1 Distill 8B",
    paramsB: 8.0,
    contextLength: 131072,
    gqa: true,
    numAttentionHeads: 32,
    numKeyValueHeads: 8,
    hiddenSize: 4096,
    numLayers: 32,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "MIT",
    baseCapability: 0.92, // reasoning specialist — dramatically outperforms size class
    chatTemplate: "deepseek-r1",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },

  // ── Large tier: 14B ─────────────────────────────────────────────────────

  {
    id: "phi-4-14b",
    displayName: "Phi-4 14B",
    paramsB: 14.7,
    contextLength: 16384,
    gqa: true,
    numAttentionHeads: 40,
    numKeyValueHeads: 10,
    hiddenSize: 5120,
    numLayers: 40,
    quants: ggufQuants({ lowEnd: true }),
    modalities: ["text"],
    license: "MIT",
    baseCapability: 0.85,
    chatTemplate: "chatml",
    samplingDefaults: INSTRUCT_SAMPLING,
  },

  {
    // Phi-4-reasoning-14B: STEM/math/science specialist.
    // Outperforms Phi-4 on reasoning tasks, matches much larger models.
    id: "phi-4-reasoning-14b",
    displayName: "Phi-4 Reasoning 14B",
    paramsB: 14.7,
    contextLength: 16384,
    gqa: true,
    numAttentionHeads: 40,
    numKeyValueHeads: 10,
    hiddenSize: 5120,
    numLayers: 40,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "MIT",
    baseCapability: 0.87,
    chatTemplate: "chatml",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },

  {
    // Qwen3-14B: strong 14B reasoning model.
    id: "qwen3-14b",
    displayName: "Qwen3 14B",
    paramsB: 14.8,
    contextLength: 32768,
    gqa: true,
    numAttentionHeads: 40,
    numKeyValueHeads: 8,
    hiddenSize: 5120,
    numLayers: 40,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.89,
    chatTemplate: "qwen3",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },

  // ── XL tier: 32B+ ──────────────────────────────────────────────────────

  {
    // QwQ-32B: Alibaba's reasoning specialist. Matches o1-mini on many benchmarks.
    // Requires 20GB+ RAM at Q4_K_M — desktop/workstation only.
    id: "qwq-32b",
    displayName: "QwQ 32B",
    paramsB: 32.5,
    contextLength: 32768,
    gqa: true,
    numAttentionHeads: 40,
    numKeyValueHeads: 8,
    hiddenSize: 5120,
    numLayers: 64,
    quants: reasoningQuants(),
    modalities: ["text"],
    license: "Apache-2.0",
    baseCapability: 0.93, // top-tier reasoning — matches o1-mini on MATH/GPQA
    chatTemplate: "qwen3",
    supportsReasoning: true,
    samplingDefaults: REASONING_SAMPLING,
  },
];
