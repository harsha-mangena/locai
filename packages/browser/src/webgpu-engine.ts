/**
 * WebGPUEngine — GPU-accelerated inference via WebGPU compute shaders.
 *
 * This is the primary browser GPU path (Tier 4 in the strategy cascade).
 * Requires a browser with WebGPU support and a capable GPU adapter.
 */

import type {
  InferenceEngine,
  EngineInfo,
  GenerateParams,
  GenerateChunk,
} from "@locai/core/engine";
import type { RunPlan } from "@locai/core/types";
import { ModelCache } from "./model-cache.ts";
import type { ProgressCallback } from "./progress.ts";

export interface WebGPUEngineOptions {
  /** Progress callback for model loading. */
  onProgress?: ProgressCallback;
}

export class WebGPUEngine implements InferenceEngine {
  readonly info: EngineInfo = {
    name: "webgpu-llama",
    backends: ["webgpu"],
    available: typeof navigator !== "undefined" && "gpu" in navigator,
  };

  private cache: ModelCache;
  private onProgress?: ProgressCallback;
  private loaded = false;

  constructor(options?: WebGPUEngineOptions) {
    this.cache = new ModelCache();
    this.onProgress = options?.onProgress;
  }

  supports(plan: RunPlan): boolean {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
    // TODO: check adapter limits against model size
    return true;
  }

  async load(_plan: RunPlan, _modelPath: string): Promise<void> {
    // TODO: implement WebGPU pipeline initialization via ModelCache
    this.loaded = true;
    this.onProgress?.({ phase: "ready", fraction: 1 });
  }

  async *generate(_params: GenerateParams): AsyncGenerator<GenerateChunk> {
    if (!this.loaded) {
      throw new Error("Engine not loaded — call load() first");
    }
    // TODO: implement WebGPU token generation
    yield { token: "", index: 0, done: true };
  }

  async unload(): Promise<void> {
    this.loaded = false;
    // TODO: release GPU buffers and destroy device
  }

  /**
   * Probe GPU adapter limits for memory assessment.
   * Returns capability info or null if WebGPU is unavailable.
   */
  static async checkCapability(): Promise<{
    available: boolean;
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
  } | null> {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;

    return {
      available: true,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    };
  }
}
