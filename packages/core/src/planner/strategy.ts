/**
 * Strategy Selector — the cascade that answers "how do we run RIGHT NOW?"
 *
 * This is the architectural upgrade that makes LocAI work on a 4 GB phone.
 * The core insight (ADR-0002): "can this model run?" and "is this model here?"
 * are two separate questions. The strategy cascade bridges them.
 *
 * Cascade order (best → acceptable):
 *   Tier 0: system-model   — OS-provided (iOS Foundation Models / Android AICore)
 *   Tier 1: native-local   — GGUF on disk, llama.cpp / ExecuTorch
 *   Tier 2: (download)     — best fitting model not on disk → schedule download,
 *                            use Tier 0/3 in the meantime
 *   Tier 3: flash-backed   — model on flash, hot weights in DRAM
 *   Tier 4: browser-webgpu — WebGPU in browser, model in OPFS
 *   Tier 5: browser-wasm   — WASM fallback, model in OPFS
 *   Tier 6: hybrid-edge    — opt-in cloud fallback
 *
 * The selector ALWAYS returns something runnable. It never returns null.
 * The user always gets a response. The upgrade path is transparent.
 */

import type {
  DeviceProfile,
  ModelDescriptor,
  QuantSpec,
  RunPlan,
  PlanRequest,
  ExecutionStrategy,
  ModelAvailability,
  DownloadPlan,
  StrategyPlan,
} from "../types.ts";
import { plan } from "./index.ts";

// ---------------------------------------------------------------------------
// System model detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the OS provides a built-in model we can use for free.
 *
 * iOS 26+: Apple Foundation Models framework (Swift API, ~3B on-device model).
 *   Available on: iPhone 15+, iPad with A17 Pro+, M-series Macs.
 *   Capability: ~0.65 (comparable to Llama 3.2 3B).
 *
 * Android 15+ (Pixel 9+, Samsung S24+): Gemini Nano via Android AICore.
 *   Available on: devices with AICore system service.
 *   Capability: ~0.65.
 *
 * In Node (desktop), neither is available — this always returns false.
 * In React Native / native mobile, the platform bridge checks the OS API.
 */
export interface SystemModelInfo {
  available: boolean;
  /** Human-readable name of the system model. */
  name: string;
  /** Rough capability score (0..1) for scoring against downloaded models. */
  capability: number;
  /** Which OS API backs this. */
  provider: "apple-foundation-models" | "android-aicore" | "none";
}

/**
 * Probe system model availability.
 *
 * In Node this always returns unavailable — the real probes live in the
 * platform-specific bridges (iOS Swift / Android Kotlin). This function is
 * the contract; the bridges override it via dependency injection.
 *
 * The `systemModelProbe` parameter lets tests and platform bridges inject
 * real detection logic without changing this module.
 */
export function detectSystemModel(
  device: DeviceProfile,
  systemModelProbe?: () => SystemModelInfo,
): SystemModelInfo {
  // If a platform bridge injected a real probe, use it.
  if (systemModelProbe) return systemModelProbe();

  // Node / synthetic: no system model.
  if (device.source === "node" || device.source === "synthetic") {
    return { available: false, name: "", capability: 0, provider: "none" };
  }

  // React Native / browser: conservative default until bridge is wired.
  // iOS 26+ on supported hardware → Foundation Models is available.
  if (device.platform === "ios") {
    // We can't call Swift from here directly; the bridge sets this.
    // Conservative: assume available on iOS 26+ (source = react-native means
    // the bridge is present and will override this anyway).
    return {
      available: true,
      name: "Apple Foundation Models (on-device)",
      capability: 0.65,
      provider: "apple-foundation-models",
    };
  }

  // Android: Gemini Nano available on Pixel 9+, Samsung S24+ with AICore.
  // The bridge will override; conservative default is unavailable.
  if (device.platform === "android") {
    return { available: false, name: "", capability: 0, provider: "none" };
  }

  return { available: false, name: "", capability: 0, provider: "none" };
}

// ---------------------------------------------------------------------------
// Flash-backed viability
// ---------------------------------------------------------------------------

/**
 * Can we run a model in DRAM-Flash hybrid mode on this device?
 *
 * Requirements:
 *   1. The model's weights exceed usable DRAM (otherwise just use native-local)
 *   2. The model fits on flash storage
 *   3. Flash is fast enough (UFS 3.1+ ≈ 1.2 GB/s sequential read)
 *      to sustain acceptable tok/s (≥ 2 tok/s minimum)
 *
 * The tok/s estimate for flash-backed mode:
 *   Each token reads ~all weights once. With DRAM-Flash swapping, only the
 *   "hot" weights (attention layers being computed) are in DRAM. The rest
 *   stream from flash. Effective bandwidth ≈ flash sequential read speed.
 *
 *   For a 3B model at Q4_K_M (~2 GB):
 *     - DRAM budget: 1.5 GB → ~75% of weights hot
 *     - Flash reads: ~500 MB per token (cold 25%)
 *     - At 1.2 GB/s flash: ~0.4s per token = ~2.5 tok/s
 *     → Marginal but usable for async/background use cases.
 *
 *   For a 7B model at Q4_K_M (~4.3 GB) on 4 GB phone:
 *     - DRAM budget: 1.5 GB → ~35% hot
 *     - Flash reads: ~2.8 GB per token
 *     - At 1.2 GB/s flash: ~2.3s per token = ~0.4 tok/s
 *     → Below minimum. Not viable.
 *
 * Conclusion: flash-backed is viable for 1B–3B models on constrained devices
 * where the model is slightly too big for DRAM but not massively so.
 */
export interface FlashBackedViability {
  viable: boolean;
  estimatedTps: number;
  reason: string;
}

const FLASH_BANDWIDTH_GBs = 1.2; // UFS 3.1 conservative sequential read
const MIN_FLASH_TPS = 2.0;

export function assessFlashBacked(
  model: ModelDescriptor,
  quant: QuantSpec,
  device: DeviceProfile,
): FlashBackedViability {
  const weightB = (model.paramsB * 1e9 * quant.bitsPerWeight) / 8;
  const dram = device.usableRamBytes;

  // If it fits in DRAM, native-local is better — don't use flash-backed.
  if (weightB <= dram * 0.75) {
    return { viable: false, estimatedTps: 0, reason: "fits in DRAM — use native-local instead" };
  }

  // Check flash space.
  if (device.freeDiskBytes != null && device.freeDiskBytes < weightB * 1.1) {
    return { viable: false, estimatedTps: 0, reason: "insufficient flash storage" };
  }

  // Estimate tok/s: fraction of weights that must be read from flash each token.
  const hotFrac = Math.min(1, (dram * 0.7) / weightB); // fraction kept in DRAM
  const coldFrac = 1 - hotFrac;
  const coldBytesPerToken = weightB * coldFrac;

  // Harmonic blend: hot part at DRAM speed, cold part at flash speed.
  // Simplified: effective bandwidth = 1 / (hotFrac/dramBW + coldFrac/flashBW)
  const DRAM_GBs = Math.min(device.memoryBandwidthGBs ?? 40, 60); // mobile DRAM ~30-60 GB/s
  const effectiveGBs =
    1 / (hotFrac / DRAM_GBs + coldFrac / FLASH_BANDWIDTH_GBs);
  const tps = (effectiveGBs * 1e9 * 0.5) / weightB; // 0.5 = mobile efficiency

  if (tps < MIN_FLASH_TPS) {
    return {
      viable: false,
      estimatedTps: tps,
      reason: `estimated ${tps.toFixed(1)} tok/s — below ${MIN_FLASH_TPS} tok/s minimum`,
    };
  }

  return {
    viable: true,
    estimatedTps: Math.round(tps * 10) / 10,
    reason: `${(hotFrac * 100).toFixed(0)}% weights hot in DRAM, ${(coldFrac * 100).toFixed(0)}% streamed from flash`,
  };
}

// ---------------------------------------------------------------------------
// Download plan builder
// ---------------------------------------------------------------------------

const HUGGINGFACE_BASE = "https://huggingface.co";

/**
 * Build a download plan for a (model, quant) pair.
 *
 * URL convention: HuggingFace GGUF repos follow a predictable pattern.
 * In production this comes from the model hub API; here we derive it
 * from the model id so the planner is self-contained.
 */
export function buildDownloadPlan(
  model: ModelDescriptor,
  quant: QuantSpec,
  device: DeviceProfile,
  networkSpeedMBps?: number,
): DownloadPlan {
  const weightBytes = (model.paramsB * 1e9 * quant.bitsPerWeight) / 8;
  const filename = `${model.id}-${quant.id.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.gguf`;

  // Derive HuggingFace repo from model id (convention: bartowski mirrors).
  // In production, the catalog carries explicit download URLs.
  const repoOwner = "bartowski";
  const repoName = model.id.replace(/[^a-z0-9-]/gi, "-");
  const url = `${HUGGINGFACE_BASE}/${repoOwner}/${repoName}-GGUF/resolve/main/${filename}`;

  const speedMBps = networkSpeedMBps ?? 5; // conservative: 5 MB/s = ~40 Mbps
  const estimatedMinutes = weightBytes / (speedMBps * 1024 * 1024) / 60;

  // Recommend WiFi-only if the download is large (>500 MB) or device is mobile.
  const wifiOnly =
    weightBytes > 500 * 1024 * 1024 ||
    device.platform === "ios" ||
    device.platform === "android";

  return {
    url,
    sizeBytes: Math.round(weightBytes),
    resumable: true, // HuggingFace supports HTTP Range
    estimatedMinutes: Math.round(estimatedMinutes),
    wifiOnly,
  };
}

// ---------------------------------------------------------------------------
// The Strategy Cascade — the main entry point
// ---------------------------------------------------------------------------

export interface StrategyCascadeRequest {
  device: DeviceProfile;
  /** Models available on disk right now. */
  localCatalog: ModelDescriptor[];
  /** Full catalog (including models not yet downloaded). */
  fullCatalog: ModelDescriptor[];
  preference?: PlanRequest["preference"];
  /** Platform bridge: detect system model (iOS/Android). */
  systemModelProbe?: () => SystemModelInfo;
  /** Current network speed estimate in MB/s (optional). */
  networkSpeedMBps?: number;
  /** Allow flash-backed inference? Default true on mobile. */
  allowFlashBacked?: boolean;
}

/**
 * THE strategy cascade. Returns a StrategyPlan that is ALWAYS runnable
 * right now, plus an optional pending upgrade for when a download completes.
 *
 * This is the function that makes LocAI work on a 4 GB phone.
 */
export function selectStrategy(req: StrategyCascadeRequest): StrategyPlan {
  const {
    device,
    localCatalog,
    fullCatalog,
    preference,
    systemModelProbe,
    networkSpeedMBps,
  } = req;
  const allowFlash = req.allowFlashBacked ?? (device.thermallyConstrained || device.platform === "android" || device.platform === "ios");

  // -------------------------------------------------------------------------
  // TIER 0: System model (iOS Foundation Models / Android AICore)
  // -------------------------------------------------------------------------
  const sysModel = detectSystemModel(device, systemModelProbe);

  // -------------------------------------------------------------------------
  // TIER 1: Best local model (already on disk)
  // -------------------------------------------------------------------------
  let localPlan: ReturnType<typeof plan> | null = null;
  if (localCatalog.length > 0) {
    localPlan = plan({ device, catalog: localCatalog, preference });
  }

  // -------------------------------------------------------------------------
  // TIER 2: Best downloadable model (not on disk, but disk space available)
  // -------------------------------------------------------------------------
  // Find the best model from the full catalog that isn't already local.
  const localIds = new Set(localCatalog.map((m) => m.id));
  const downloadableCatalog = fullCatalog.filter((m) => !localIds.has(m.id));
  let downloadPlan: ReturnType<typeof plan> | null = null;
  if (downloadableCatalog.length > 0) {
    downloadPlan = plan({ device, catalog: downloadableCatalog, preference });
  }

  // -------------------------------------------------------------------------
  // TIER 3: Flash-backed (model on flash, hot weights in DRAM)
  // -------------------------------------------------------------------------
  // Check if any full-catalog model is viable in flash-backed mode.
  let flashPlan: { model: ModelDescriptor; quant: QuantSpec; tps: number } | null = null;
  if (allowFlash) {
    for (const m of fullCatalog) {
      for (const q of m.quants) {
        const v = assessFlashBacked(m, q, device);
        if (v.viable && (!flashPlan || v.estimatedTps > flashPlan.tps)) {
          flashPlan = { model: m, quant: q, tps: v.estimatedTps };
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Decision: what runs RIGHT NOW?
  // -------------------------------------------------------------------------

  // Case A: We have a local model. Use it. Also schedule a better download if
  // the downloadable catalog has something significantly better.
  if (localPlan?.best) {
    const current = localPlan.best;
    const rationale: string[] = [
      `Using ${current.model.displayName} (${current.quant.id}) — already on device.`,
      ...current.rationale,
    ];

    // Is there a meaningfully better model we could download?
    let pendingUpgrade: StrategyPlan["pendingUpgrade"] = undefined;
    if (
      downloadPlan?.best &&
      downloadPlan.best.predicted.score > current.predicted.score * 1.1 // >10% better
    ) {
      const better = downloadPlan.best;
      const dp = buildDownloadPlan(better.model, better.quant, device, networkSpeedMBps);
      if (device.freeDiskBytes == null || device.freeDiskBytes > dp.sizeBytes * 1.2) {
        pendingUpgrade = {
          strategy: "native-local",
          runPlan: better,
          downloadPlan: dp,
        };
        rationale.push(
          `Better model available: ${better.model.displayName} (${better.quant.id}) — ${fmtMB(dp.sizeBytes)} download.`,
        );
      }
    }

    return {
      strategy: "native-local",
      runPlan: current,
      availability: "ready",
      pendingUpgrade,
      rationale,
    };
  }

  // Case B: No local model. Use system model immediately if available,
  // AND schedule the best downloadable model in the background.
  if (sysModel.available) {
    const rationale: string[] = [
      `Using ${sysModel.name} — provided by the OS, zero download required.`,
      `Fully private: inference runs on-device via ${sysModel.provider === "apple-foundation-models" ? "Apple Foundation Models (iOS 26)" : "Android AICore (Gemini Nano)"}.`,
    ];

    let pendingUpgrade: StrategyPlan["pendingUpgrade"] = undefined;
    if (downloadPlan?.best) {
      const better = downloadPlan.best;
      const dp = buildDownloadPlan(better.model, better.quant, device, networkSpeedMBps);
      if (device.freeDiskBytes == null || device.freeDiskBytes > dp.sizeBytes * 1.2) {
        pendingUpgrade = {
          strategy: "native-local",
          runPlan: better,
          downloadPlan: dp,
        };
        rationale.push(
          `Downloading ${better.model.displayName} (${better.quant.id}) in background — ${fmtMB(dp.sizeBytes)}, ~${dp.estimatedMinutes} min on WiFi.`,
        );
        rationale.push(
          `Will automatically upgrade to local model when download completes.`,
        );
      }
    }

    return {
      strategy: "system-model",
      runPlan: null, // system model has no RunPlan — the OS manages it
      availability: "system",
      pendingUpgrade,
      rationale,
    };
  }

  // Case C: No local model, no system model. Can we download something?
  if (downloadPlan?.best) {
    const best = downloadPlan.best;
    const dp = buildDownloadPlan(best.model, best.quant, device, networkSpeedMBps);
    const hasSpace = device.freeDiskBytes == null || device.freeDiskBytes > dp.sizeBytes * 1.2;

    if (hasSpace) {
      const rationale: string[] = [
        `No model on device yet. Recommending download: ${best.model.displayName} (${best.quant.id}).`,
        `Size: ${fmtMB(dp.sizeBytes)}${dp.estimatedMinutes ? `, ~${dp.estimatedMinutes} min on WiFi` : ""}.`,
        `Once downloaded, will run at ~${best.predicted.tokensPerSecEstimate} tok/s fully offline.`,
      ];

      // While downloading, can we use flash-backed as a bridge?
      if (flashPlan) {
        rationale.push(
          `Flash-backed inference available during download: ${flashPlan.model.displayName} at ~${flashPlan.tps} tok/s.`,
        );
      }

      return {
        strategy: flashPlan ? "flash-backed" : "browser-wasm",
        runPlan: null,
        availability: "available",
        downloadPlan: dp,
        pendingUpgrade: {
          strategy: "native-local",
          runPlan: best,
          downloadPlan: dp,
        },
        rationale,
      };
    }

    // Not enough space.
    return {
      strategy: "browser-wasm",
      runPlan: null,
      availability: "no-space",
      rationale: [
        `Insufficient storage for ${best.model.displayName} (${fmtMB(dp.sizeBytes)} needed).`,
        `Falling back to browser-based inference (model cached in browser storage).`,
        `Free up ${fmtMB(dp.sizeBytes - (device.freeDiskBytes ?? 0))} of storage to enable local model.`,
      ],
    };
  }

  // Case D: Nothing works. This should be extremely rare (no catalog, no system
  // model, no disk space). Return a hybrid-edge plan as last resort.
  return {
    strategy: "hybrid-edge",
    runPlan: null,
    availability: "no-space",
    rationale: [
      "No local model available and device storage is full.",
      "Hybrid edge mode available as opt-in fallback (requires internet + user consent).",
      "Free up storage or connect to WiFi to enable local inference.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMB(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 ** 3)).toFixed(1) + " GB";
  return (bytes / (1024 * 1024)).toFixed(0) + " MB";
}
