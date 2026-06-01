/**
 * LocAI core — public surface.
 */
export * from "./types.ts";
export { profileDevice } from "./profiler/index.ts";
export { plan } from "./planner/index.ts";
export { selectStrategy, assessFlashBacked, detectSystemModel } from "./planner/strategy.ts";
export { SEED_CATALOG } from "./catalog/seed.ts";
export { ModelHub } from "./catalog/hub.ts";
export { ToolRegistry } from "./tools/registry.ts";
export { ToolExecutor } from "./tools/executor.ts";
export {
  makeCodingTools,
  registerCodingTools,
  makeFileReadTool,
  makeFileWriteTool,
  makeShellExecTool,
  makeGrepSearchTool,
  makeGitStatusTool,
  makeGitDiffTool,
  makeWebFetchTool,
} from "./tools/coding.ts";
export {
  EngineRouter,
  type InferenceEngine,
  type EngineInfo,
  type GenerateParams,
  type GenerateChunk,
} from "./engine/index.ts";
export {
  totalRuntimeBytes,
  tokensPerSecEstimate,
  weightBytes,
  kvCacheBytes,
} from "./planner/resource.ts";
export { effectiveCapability, qualityRetentionForBpw } from "./planner/quality.ts";
