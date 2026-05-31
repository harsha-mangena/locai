/**
 * Seed model catalog.
 *
 * A curated set spanning the device spectrum (1.5B mobile -> 14B desktop), all
 * GGUF-native so they run on the portable ggml backend everywhere. Architecture
 * dims are real (from each model's config) so KV-cache sizing is accurate.
 *
 * quant qualityRetention values are left undefined where we want the planner's
 * bpw-curve to compute them; set explicitly only when we have measured data.
 *
 * In production this is fetched from the model hub; here it's a static seed so
 * the planner is runnable today with zero network.
 */

import type { ModelDescriptor, QuantSpec } from "../types.ts";

/** Standard GGUF quant ladder with effective bpw (incl. metadata overhead). */
function ggufQuants(opts?: { lowEnd?: boolean }): QuantSpec[] {
  const q: QuantSpec[] = [
    { family: "gguf", id: "Q8_0", bitsPerWeight: 8.5, qualityRetention: 0.999 },
    { family: "gguf", id: "Q6_K", bitsPerWeight: 6.6, qualityRetention: 0.997 },
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

export const SEED_CATALOG: ModelDescriptor[] = [
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
    baseCapability: 0.5,
  },
  {
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
  },
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
  },
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
  },
];
