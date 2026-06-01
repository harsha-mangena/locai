/**
 * LocAI core type system.
 *
 * These are the atomic contracts the whole runtime composes from:
 *   DeviceProfile      -> what hardware we have
 *   QuantSpec          -> a way of compressing a model
 *   ModelDescriptor    -> a model we could run
 *   RunPlan            -> the chosen (model, quant, backend, params) for THIS device
 *   ExecutionStrategy  -> HOW we run: system model, native local, flash-backed, browser, hybrid
 *   ModelAvailability  -> WHERE the model is: on disk, downloading, system-provided, etc.
 *
 * Everything downstream (profiler, planner, router, server) speaks these types.
 * Keep this file dependency-free so it can run identically in Node, the browser,
 * and React Native.
 *
 * ARCHITECTURE NOTE (ADR-0002):
 * The fundamental insight is that "can this model run?" and "is this model here?"
 * are two separate questions. The planner answers the first; the ModelHub answers
 * the second. The strategy cascade bridges them: it always returns something
 * runnable RIGHT NOW, while scheduling the optimal model for background delivery.
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

/**
 * Chat template format the model expects.
 *
 * Each model family has a specific prompt format baked into its weights.
 * Using the wrong template produces garbage output regardless of model quality.
 *
 *   llama3       — Meta Llama 3.x family (<|begin_of_text|>, <|eot_id|>)
 *   chatml       — Qwen2.x, Phi-3/4, many others (<|im_start|>, <|im_end|>)
 *   qwen3        — Qwen3 family: ChatML + optional <think> reasoning block
 *   deepseek-r1  — DeepSeek-R1: ChatML + <think>...</think> reasoning block
 *   gemma        — Google Gemma (<start_of_turn>, <end_of_turn>)
 *   mistral      — Mistral/Mixtral ([INST], [/INST])
 *   phi4-mini    — Phi-4-mini specific format
 *   generic      — Fallback: ROLE: content\n
 */
export type ChatTemplateFormat =
  | "llama3"
  | "chatml"
  | "qwen3"
  | "deepseek-r1"
  | "gemma"
  | "mistral"
  | "phi4-mini"
  | "generic";

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
  /**
   * A capability score 0..1 (general quality at fp16) for utility ranking.
   *
   * Calibrated against MMLU/GPQA/HumanEval/LiveBench 2025 benchmarks.
   * These are NOT arbitrary — they reflect real measured performance:
   *   0.50 = Qwen2.5-1.5B  (basic tasks, simple Q&A)
   *   0.62 = Llama 3.2 3B  (solid general assistant)
   *   0.72 = Qwen3-4B      (strong reasoning for size, matches some 7B)
   *   0.79 = Qwen2.5-7B    (competitive 7B)
   *   0.80 = Llama 3.1 8B  (strong general 8B)
   *   0.83 = Qwen3-8B      (best open 8B reasoning as of 2025)
   *   0.85 = Phi-4 14B     (punches above weight on reasoning)
   *   0.87 = Phi-4-reasoning 14B (STEM/math specialist)
   *   0.89 = Qwen3-14B     (strong 14B reasoning)
   *   0.92 = DeepSeek-R1-8B (reasoning specialist, matches much larger models)
   */
  baseCapability: number;
  /**
   * Chat template format this model uses.
   * Critical: wrong template = garbage output regardless of model quality.
   * Defaults to "generic" if not specified (safe fallback, not optimal).
   */
  chatTemplate: ChatTemplateFormat;
  /**
   * Does this model support extended chain-of-thought / reasoning mode?
   * Reasoning models emit a <think>...</think> block before the answer.
   * The runtime can optionally strip or expose this block.
   */
  supportsReasoning?: boolean;
  /**
   * Recommended sampling parameters for this model.
   * Reasoning models need different settings than instruct models.
   * These override the engine defaults when set.
   */
  samplingDefaults?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    minP?: number;
    repeatPenalty?: number;
  };
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
    /**
     * Honest fit classification against the backend's fast memory:
     *   "comfortable" — fits with headroom, bandwidth-bound speed
     *   "tight"       — fits but near the ceiling; KV growth is risky
     *   "thrash"      — working set spills past fast memory; paging derates speed
     *   "over-cliff"  — weights exceed fast memory; flash-streaming, unusable
     * The planner refuses to RETURN thrash/over-cliff as `best`, but exposes the
     * class so the UI can explain *why* a bigger model was rejected.
     */
    fitClass: "comfortable" | "tight" | "thrash" | "over-cliff";
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

// ---------------------------------------------------------------------------
// Strategy — HOW we run on this device right now
// ---------------------------------------------------------------------------

/**
 * The execution strategy the runtime will use for this device+state.
 *
 * The planner cascades through these in order of preference:
 *   system-model  → OS-provided model (iOS Foundation Models / Android AICore).
 *                   Zero download, zero RAM cost, always available on supported OS.
 *   native-local  → llama.cpp (Vulkan/Metal/CPU) or ExecuTorch on-device.
 *                   Best performance, fully offline, requires a downloaded GGUF.
 *   flash-backed  → DRAM-Flash hybrid (MNN-LLM style). Model lives on flash,
 *                   hot weights streamed to DRAM. Enables 3B–7B on 2 GB DRAM.
 *   browser-wasm  → wllama (WASM) in browser. Zero install, model in OPFS cache.
 *   browser-webgpu→ LlamaWeb / WebLLM WebGPU backend. Faster than WASM.
 *   hybrid-edge   → On-device small model + cloud for complex queries. Opt-in only.
 */
export type ExecutionStrategy =
  | "system-model"
  | "native-local"
  | "flash-backed"
  | "browser-wasm"
  | "browser-webgpu"
  | "hybrid-edge";

/**
 * Where the model weights are right now.
 *
 *   system      → provided by the OS, no download needed or possible
 *   ready       → GGUF on disk, can run immediately
 *   downloading → download in progress (progress 0..1 available)
 *   queued      → scheduled for background download, not started yet
 *   available   → not on disk but disk space exists; download recommended
 *   no-space    → not on disk and insufficient free space
 */
export type ModelAvailability =
  | "system"
  | "ready"
  | "downloading"
  | "queued"
  | "available"
  | "no-space";

/** A pending or in-progress model download. */
export interface DownloadPlan {
  /** Where to fetch the GGUF from. */
  url: string;
  /** Total bytes to download. */
  sizeBytes: number;
  /** Server supports HTTP Range (resumable). */
  resumable: boolean;
  /** Rough estimate at current network speed, in minutes. */
  estimatedMinutes?: number;
  /** Recommended: only download on WiFi? */
  wifiOnly: boolean;
}

// ---------------------------------------------------------------------------
// Extended RunPlan — adds strategy + availability to the existing plan
// ---------------------------------------------------------------------------

/**
 * The full plan the runtime executes. Extends the core RunPlan with:
 *   - which execution strategy to use
 *   - where the model weights are right now
 *   - what to do if they're not here yet (downloadPlan)
 *
 * The strategy cascade guarantees that `best` is ALWAYS something that can
 * run RIGHT NOW — even if that means using the system model while a better
 * one downloads in the background.
 */
export interface StrategyPlan {
  /** The execution strategy for this device+state. */
  strategy: ExecutionStrategy;
  /** The underlying model/quant/backend plan (null only for system-model). */
  runPlan: RunPlan | null;
  /** Where the model weights are. */
  availability: ModelAvailability;
  /**
   * If availability is "available" or "queued", this describes the download.
   * The UI should show this to the user before starting.
   */
  downloadPlan?: DownloadPlan;
  /**
   * A better plan that will become available once a download completes.
   * The runtime upgrades to this automatically when the download finishes.
   */
  pendingUpgrade?: {
    strategy: ExecutionStrategy;
    runPlan: RunPlan;
    downloadPlan: DownloadPlan;
  };
  /** Human-readable explanation of the strategy choice. */
  rationale: string[];
}
