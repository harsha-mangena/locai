/**
 * LocAI core type system.
 *
 * These are the atomic contracts the whole runtime composes from:
 *   DeviceProfile  -> what hardware we have
 *   QuantSpec      -> a way of compressing a model
 *   ModelDescriptor-> a model we could run
 *   RunPlan        -> the chosen (model, quant, backend, params) for THIS device
 *
 * Everything downstream (profiler, planner, router, server) speaks these types.
 * Keep this file dependency-free so it can run identically in Node, the browser,
 * and React Native.
 */

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export type Platform =
  | "macos"
  | "windows"
  | "linux"
  | "ios"
  | "android"
  | "browser";

export type CpuArch = "arm64" | "x64" | "wasm32" | "unknown";

/** A compute backend we can route inference to. Mirrors the ggml backend matrix
 *  plus the browser/NPU paths from our research. */
export type BackendKind =
  | "cpu" // SIMD: AVX/AVX-512 (x64), NEON/SVE (arm64)
  | "metal" // Apple GPU
  | "cuda" // NVIDIA
  | "vulkan" // cross-vendor GPU (the portable GPU path)
  | "rocm" // AMD (hip)
  | "sycl" // Intel GPU
  | "webgpu" // browser GPU
  | "wasm" // browser CPU fallback
  | "coreml" // Apple NPU/ANE delegate
  | "qnn" // Qualcomm Hexagon NPU
  | "openvino"; // Intel NPU

export interface AcceleratorInfo {
  kind: BackendKind;
  /** Human label, e.g. "Apple M1 Pro GPU". */
  name: string;
  /** Dedicated/usable memory for this accelerator in bytes. On unified-memory
   *  systems (Apple Silicon) this is shared with system RAM — see `unifiedMemory`. */
  memoryBytes?: number;
  /** True when GPU shares system RAM (Apple Silicon, integrated GPUs). */
  unifiedMemory?: boolean;
  /** Rough relative throughput hint (0..1) used only for tie-breaking. */
  perfHint?: number;
  available: boolean;
}

export interface DeviceProfile {
  platform: Platform;
  arch: CpuArch;
  /** Total physical system RAM in bytes. */
  totalRamBytes: number;
  /** RAM the OS will realistically let one process use, in bytes.
   *  On mobile this is FAR below totalRam (jetsam/thermal). */
  usableRamBytes: number;
  cpu: {
    brand: string;
    physicalCores: number;
    logicalCores: number;
    /** SIMD ISA features that matter for kernel selection. */
    features: string[];
  };
  /** Ordered best-first list of accelerators actually usable on this device. */
  accelerators: AcceleratorInfo[];
  /** Memory bandwidth in GB/s if known — decode is bandwidth-bound. */
  memoryBandwidthGBs?: number;
  /** Is this a thermally/battery constrained device (phone/tablet/fanless)? */
  thermallyConstrained: boolean;
  /** Free disk space for model downloads, in bytes, if known. */
  freeDiskBytes?: number;
  /** When/where this profile was captured. */
  capturedAt: string;
  source: "node" | "browser" | "react-native" | "synthetic";
}

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

/** Format families from our research teardown. */
export type QuantFamily =
  | "gguf" // llama.cpp universe (k-quants, i-quants, +imatrix, UD dynamic)
  | "mlx" // Apple
  | "awq"
  | "gptq"
  | "exl2"
  | "exl3"
  | "fp16"
  | "fp32";

export interface QuantSpec {
  family: QuantFamily;
  /** Concrete quant id, e.g. "Q4_K_M", "IQ4_XS", "Q4_K_M-imatrix", "4bit-gs64". */
  id: string;
  /** Effective bits per weight (bpw). The single most important number for
   *  sizing memory and predicting quality. */
  bitsPerWeight: number;
  /** Was an importance-matrix / data-aware calibration used? Critical <=4-bit. */
  imatrix?: boolean;
  /** Per-layer mixed bit allocation (UD / EXL2/3 / mixed k-quant). */
  dynamic?: boolean;
  /**
   * Quality retention estimate vs fp16 on a 0..1 scale (1 = lossless).
   * Empirical priors from the literature; refined by `planner/quality.ts`.
   */
  qualityRetention: number;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelDescriptor {
  /** Stable id, e.g. "qwen2.5-7b-instruct". */
  id: string;
  displayName: string;
  /** Parameter count in billions (e.g. 7, 3.8, 1.5). */
  paramsB: number;
  /** Context length the weights support. */
  contextLength: number;
  /** Uses grouped-query attention? Shrinks KV cache massively. */
  gqa: boolean;
  /** kv heads / query heads info for KV-cache sizing, if known. */
  numKeyValueHeads?: number;
  numAttentionHeads?: number;
  hiddenSize?: number;
  numLayers?: number;
  /** Quant variants available for this model. */
  quants: QuantSpec[];
  /** Modality. MVP = text; vision/audio later. */
  modalities: Array<"text" | "vision" | "audio">;
  /** License of the weights. */
  license: string;
  /** A capability score 0..1 (general quality at fp16) for utility ranking. */
  baseCapability: number;
}

// ---------------------------------------------------------------------------
// The Plan — the output of the moat
// ---------------------------------------------------------------------------

export interface RunPlan {
  model: ModelDescriptor;
  quant: QuantSpec;
  backend: BackendKind;
  /** Recommended runtime params tuned to the device. */
  params: {
    contextLength: number;
    /** Quantize the KV cache? type per K and V. */
    kvCacheType: "f16" | "q8_0" | "q4_0";
    /** How many transformer layers to offload to the accelerator. */
    gpuLayers: number | "all";
    threads: number;
    /** Enable speculative decoding with a draft model if beneficial. */
    speculative: boolean;
  };
  /** Predicted resource use, for the "will this run well?" badge. */
  predicted: {
    weightsBytes: number;
    kvCacheBytes: number;
    totalRuntimeBytes: number;
    /** Fraction of usable RAM this plan consumes (0..1, lower is safer). */
    memoryPressure: number;
    /** Rough tokens/sec estimate for decode. */
    tokensPerSecEstimate: number;
    /** Composite 0..1: quality * fit * speed. Higher is better. */
    score: number;
    /** Quality retention (0..1) of the chosen quant. */
    qualityRetention: number;
  };
  /** Why the planner chose this — human-readable, surfaced in UI. */
  rationale: string[];
  /** Confidence the plan will run without OOM/thermal kill (0..1). */
  confidence: number;
}

export interface PlanRequest {
  device: DeviceProfile;
  /** Candidate models to choose among. */
  catalog: ModelDescriptor[];
  /** User intent knob. */
  preference?: {
    /** Bias toward "quality" (bigger/better) or "speed" (snappier) or "balanced". */
    goal?: "quality" | "speed" | "balanced";
    /** Desired context length (tokens). Planner ensures it fits. */
    minContext?: number;
    /** Hard ceiling on memory pressure (0..1). Default 0.8. */
    maxMemoryPressure?: number;
    /** Restrict to a modality. */
    modality?: "text" | "vision" | "audio";
  };
}
