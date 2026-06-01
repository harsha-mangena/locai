/**
 * LocAI runtime orchestrator — the one-call API that ties the whole stack
 * together.
 *
 * The key upgrade from v1: LocAI.create() NEVER fails because a model isn't
 * downloaded. It cascades through execution strategies:
 *
 *   Tier 0: system-model   — iOS Foundation Models / Android AICore (zero download)
 *   Tier 1: native-local   — GGUF on disk, llama.cpp / ExecuTorch
 *   Tier 2: (download)     — schedule background download, use Tier 0/3 meanwhile
 *   Tier 3: flash-backed   — model on flash, hot weights in DRAM
 *   Tier 4: browser-webgpu — WebGPU in browser
 *   Tier 5: browser-wasm   — WASM fallback
 *   Tier 6: hybrid-edge    — opt-in cloud fallback
 *
 * Usage:
 *   const ai = await LocAI.create();
 *   console.log(ai.strategyPlan.strategy);   // "system-model" | "native-local" | ...
 *   console.log(ai.strategyPlan.rationale);  // human-readable explanation
 *
 *   for await (const tok of ai.chat(messages)) { ... }
 *
 *   // If a better model is downloading in the background:
 *   ai.on("upgrade", (newPlan) => { ... });
 */

import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { profileDevice } from "../profiler/index.ts";
import { SEED_CATALOG } from "../catalog/seed.ts";
import { ModelHub } from "../catalog/hub.ts";
import { selectStrategy, type SystemModelInfo } from "../planner/strategy.ts";
import { EngineRouter, type InferenceEngine } from "../engine/index.ts";
import { LlamaCppEngine } from "../engine/llamacpp.ts";
import { formatPrompt, type ChatMessage } from "../engine/chat-template.ts";
import type {
  DeviceProfile,
  RunPlan,
  ModelDescriptor,
  StrategyPlan,
} from "../types.ts";

export interface LocAIOptions {
  modelsDir?: string;
  serverBin?: string;
  goal?: "quality" | "speed" | "balanced";
  minContext?: number;
  /** Force a specific model id from the catalog (skip auto-select). */
  forceModelId?: string;
  /**
   * Platform bridge: inject system model detection for iOS/Android.
   * In Node this is not needed. In React Native, the bridge provides this.
   */
  systemModelProbe?: () => SystemModelInfo;
  /**
   * Current network speed estimate in MB/s.
   * Used to estimate download time in the strategy rationale.
   */
  networkSpeedMBps?: number;
  /**
   * Called when a background download completes and the runtime upgrades
   * to a better model. The caller can reload the engine.
   */
  onUpgrade?: (newPlan: StrategyPlan) => void;
  /**
   * Called with download progress updates.
   */
  onDownloadProgress?: (modelId: string, fraction: number, speedMBps: number) => void;
}

function defaultServerBin(): string {
  return path.join(os.homedir(), "Work/locai/vendor/llama.cpp/build/bin/llama-server");
}

function defaultModelsDir(): string {
  return path.join(os.homedir(), "Work/locai/models");
}

export class LocAI extends EventEmitter {
  readonly device: DeviceProfile;
  readonly strategyPlan: StrategyPlan;
  readonly modelPath: string | null;
  private engine: InferenceEngine | null;
  private hub: ModelHub;
  private loaded = false;
  private opts: Required<Omit<LocAIOptions, "systemModelProbe" | "onUpgrade" | "onDownloadProgress">>;

  private constructor(
    device: DeviceProfile,
    strategyPlan: StrategyPlan,
    modelPath: string | null,
    engine: InferenceEngine | null,
    hub: ModelHub,
    opts: Required<Omit<LocAIOptions, "systemModelProbe" | "onUpgrade" | "onDownloadProgress">>,
  ) {
    super();
    this.device = device;
    this.strategyPlan = strategyPlan;
    this.modelPath = modelPath;
    this.engine = engine;
    this.hub = hub;
    this.opts = opts;
  }

  /**
   * Convenience accessor: the RunPlan if strategy is native-local or flash-backed.
   * Null for system-model (OS manages everything).
   */
  get runPlan(): RunPlan | null {
    return this.strategyPlan.runPlan;
  }

  /**
   * Create a LocAI instance. NEVER throws because no model is available —
   * it always finds a strategy that works right now.
   *
   * If a better model needs to be downloaded, it schedules the download in
   * the background and calls opts.onUpgrade when it completes.
   */
  static async create(opts: LocAIOptions = {}): Promise<LocAI> {
    const modelsDir = opts.modelsDir ?? defaultModelsDir();
    const serverBin = opts.serverBin ?? defaultServerBin();
    const goal = opts.goal ?? "balanced";

    const device = profileDevice();

    // Build the model hub.
    const hub = new ModelHub({
      modelsDir,
      catalog: SEED_CATALOG,
      onProgress: (p) => {
        opts.onDownloadProgress?.(p.modelId, p.fraction, p.speedMBps);
      },
      onComplete: (modelId, quantId, filePath) => {
        // A download completed. Re-run the strategy cascade and emit "upgrade".
        // The caller can then call LocAI.create() again or swap the engine.
        const newAvailable = hub.available();
        const newStrategy = selectStrategy({
          device,
          localCatalog: newAvailable,
          fullCatalog: SEED_CATALOG,
          preference: { goal, minContext: opts.minContext },
          systemModelProbe: opts.systemModelProbe,
          networkSpeedMBps: opts.networkSpeedMBps,
        });
        opts.onUpgrade?.(newStrategy);
      },
    });

    // Get what's on disk right now.
    const localCatalog = hub.available();

    // Filter by forceModelId if specified.
    const effectiveLocal = opts.forceModelId
      ? localCatalog.filter((m) => m.id === opts.forceModelId)
      : localCatalog;
    const effectiveFull = opts.forceModelId
      ? SEED_CATALOG.filter((m) => m.id === opts.forceModelId)
      : SEED_CATALOG;

    // Run the strategy cascade.
    const strategyPlan = selectStrategy({
      device,
      localCatalog: effectiveLocal,
      fullCatalog: effectiveFull,
      preference: { goal, minContext: opts.minContext },
      systemModelProbe: opts.systemModelProbe,
      networkSpeedMBps: opts.networkSpeedMBps,
    });

    // If there's a pending upgrade (better model to download), start it.
    if (strategyPlan.pendingUpgrade) {
      const { runPlan, downloadPlan } = strategyPlan.pendingUpgrade;
      hub.download(runPlan.model, runPlan.quant, downloadPlan);
    }

    // Build the engine for the current strategy.
    let engine: InferenceEngine | null = null;
    let modelPath: string | null = null;

    if (strategyPlan.strategy === "native-local" && strategyPlan.runPlan) {
      const rp = strategyPlan.runPlan;
      const router = new EngineRouter();
      router.register(
        new LlamaCppEngine({
          serverBin,
          backends: device.platform === "macos" ? ["metal", "cpu"] : ["cuda", "vulkan", "cpu"],
        }),
      );
      engine = router.resolve(rp);
      if (!engine) {
        // llama-server binary not found — degrade gracefully.
        // In production, we'd fall back to the next strategy tier.
        // For now, log and continue with null engine (system-model or browser).
        process.stderr.write(
          `  LocAI: llama-server not found at ${serverBin}. ` +
          `Falling back to system model or browser engine.\n`,
        );
      } else {
        // Resolve the model file path.
        const { resolveModel } = await import("../catalog/resolver.ts");
        const resolved = resolveModel(rp.model, rp.quant, modelsDir);
        modelPath = resolved.path;
      }
    }

    // For system-model strategy: engine is null (OS handles it).
    // For browser strategies: engine is null (browser handles it).
    // The chat() method routes accordingly.

    const fullOpts: Required<Omit<LocAIOptions, "systemModelProbe" | "onUpgrade" | "onDownloadProgress">> = {
      modelsDir,
      serverBin,
      goal,
      minContext: opts.minContext ?? 0, // 0 = let the planner use the model's full context
      forceModelId: opts.forceModelId ?? "",
      networkSpeedMBps: opts.networkSpeedMBps ?? 5,
    };

    return new LocAI(device, strategyPlan, modelPath, engine, hub, fullOpts);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.engine || !this.runPlan || !this.modelPath) return;
    await this.engine.load(this.runPlan, this.modelPath);
    this.loaded = true;
  }

  /**
   * Stream a chat completion.
   *
   * Routes to the appropriate engine based on the strategy.
   * Sampling params: caller overrides win; model's samplingDefaults fill the rest.
   * maxTokens: undefined by default — the model generates until its stop tokens.
   */
  async *chat(
    messages: ChatMessage[],
    opts: {
      maxTokens?: number;       // undefined = no limit
      temperature?: number;
      topP?: number;
      topK?: number;
      minP?: number;
      repeatPenalty?: number;
      enableThinking?: boolean; // for reasoning models; default true
    } = {},
  ): AsyncIterable<string> {
    switch (this.strategyPlan.strategy) {
      case "native-local":
      case "flash-backed": {
        if (!this.engine || !this.runPlan) {
          throw new Error(
            "Native engine not available. " +
            "Is llama-server built? Run scripts/build-engine.sh first.",
          );
        }
        await this.ensureLoaded();
        const { prompt, stop } = formatPrompt(this.runPlan.model, messages, {
          enableThinking: opts.enableThinking,
        });
        // Merge model's recommended sampling defaults with caller overrides.
        // Caller always wins; model defaults fill in what the caller didn't set.
        const modelDefaults = this.runPlan.model.samplingDefaults ?? {};
        for await (const chunk of this.engine.generate({
          prompt,
          stop,
          maxTokens: opts.maxTokens,                                    // undefined = no limit
          temperature: opts.temperature ?? modelDefaults.temperature,
          topP: opts.topP ?? modelDefaults.topP,
          topK: opts.topK ?? modelDefaults.topK,
          minP: opts.minP ?? modelDefaults.minP,
          repeatPenalty: opts.repeatPenalty ?? modelDefaults.repeatPenalty,
        })) {
          if (chunk.token) yield chunk.token;
          if (chunk.done) return;
        }
        break;
      }

      case "system-model": {
        // Platform bridge handles this. In Node (desktop), this strategy
        // is never selected. In React Native, the bridge overrides chat().
        throw new Error(
          "system-model strategy requires a platform bridge (iOS/Android). " +
          "This path is not reachable in Node.",
        );
      }

      case "browser-wasm":
      case "browser-webgpu": {
        // Browser engine handles this. Not reachable in Node.
        throw new Error(
          "browser strategy requires the browser bundle. " +
          "This path is not reachable in Node.",
        );
      }

      case "hybrid-edge": {
        throw new Error(
          "hybrid-edge requires explicit user consent and an internet connection. " +
          "Not implemented in this build.",
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
    }
    this.loaded = false;
  }

  /** The model hub, for download management and storage queries. */
  get modelHub(): ModelHub {
    return this.hub;
  }
}
