/**
 * @locai/browser — Browser inference engines for LocAI.
 *
 * Provides WASM (wllama) and WebGPU engines that implement the InferenceEngine
 * interface, plus a shared OPFS-based ModelCache.
 */

export { WasmEngine } from "./wasm-engine.ts";
export type { WasmEngineOptions } from "./wasm-engine.ts";

export { WebGPUEngine } from "./webgpu-engine.ts";
export type { WebGPUEngineOptions } from "./webgpu-engine.ts";

export { ModelCache } from "./model-cache.ts";
export type { CachedModelInfo, DownloadOptions } from "./model-cache.ts";

export type { LoadProgressEvent, ProgressCallback } from "./progress.ts";

export {
  isWebGPUAvailable,
  probeGPULimits,
  isOPFSAvailable,
} from "./supports.ts";
