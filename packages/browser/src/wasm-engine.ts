/**
 * WasmEngine — WASM-based GGUF inference using @wllama/wllama.
 *
 * This is the universal browser fallback (Tier 5 in the strategy cascade).
 * Works on any browser with WebAssembly support.
 */

import type {
  InferenceEngine,
  EngineInfo,
  GenerateParams,
  GenerateChunk,
} from "@locai/core/engine";
import type { RunPlan } from "@locai/core/types";
import { ModelCache } from "./model-cache.ts";
import type { LoadProgressEvent, ProgressCallback } from "./progress.ts";

export interface WasmEngineOptions {
  /** Base URL for wllama WASM files (default: bundled). */
  wasmBaseUrl?: string;
  /** Progress callback for model loading. */
  onProgress?: ProgressCallback;
}

export class WasmEngine implements InferenceEngine {
  readonly info: EngineInfo = {
    name: "wllama",
    backends: ["wasm"],
    available: typeof WebAssembly !== "undefined",
  };

  private cache: ModelCache;
  private onProgress?: ProgressCallback;
  private loaded = false;

  constructor(options?: WasmEngineOptions) {
    this.cache = new ModelCache();
    this.onProgress = options?.onProgress;
  }

  supports(_plan: RunPlan): boolean {
    return this.info.available;
  }

  async load(_plan: RunPlan, _modelPath: string): Promise<void> {
    // TODO: implement wllama model loading via ModelCache
    this.loaded = true;
    this.onProgress?.({ phase: "ready", fraction: 1 });
  }

  async *generate(_params: GenerateParams): AsyncGenerator<GenerateChunk> {
    if (!this.loaded) {
      throw new Error("Engine not loaded — call load() first");
    }
    // TODO: implement wllama streaming token generation
    yield { token: "", index: 0, done: true };
  }

  async unload(): Promise<void> {
    this.loaded = false;
    // TODO: free wllama WASM memory
  }

  /** List models currently cached in OPFS. */
  async getCachedModels() {
    return this.cache.list();
  }

  /** Remove a cached model from OPFS. */
  async deleteModel(modelId: string, quantId: string) {
    return this.cache.delete(modelId, quantId);
  }
}
