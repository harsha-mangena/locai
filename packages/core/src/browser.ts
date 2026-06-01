/**
 * Browser entry point for @locai/core.
 *
 * This barrel re-exports only the types, interfaces, and pure functions needed
 * by browser inference engines (WasmEngine, WebGPUEngine). It deliberately
 * excludes Node-specific modules (llamacpp, profiler/node, server, CLI) so that
 * bundlers can tree-shake them out of browser builds.
 *
 * Usage:
 *   import { type InferenceEngine, type RunPlan, EngineRouter } from "@locai/core/browser";
 */

// --- Core types (dependency-free, runs in any environment) ---
export type {
  Platform,
  CpuArch,
  BackendKind,
  AcceleratorInfo,
  DeviceProfile,
  QuantFamily,
  QuantSpec,
  ChatTemplateFormat,
  ModelDescriptor,
  RunPlan,
  PlanRequest,
  ExecutionStrategy,
  ModelAvailability,
  DownloadPlan,
  StrategyPlan,
} from "./types.ts";

// --- Engine contract (the interface browser engines implement) ---
export {
  EngineRouter,
  type InferenceEngine,
  type EngineInfo,
  type GenerateParams,
  type GenerateChunk,
} from "./engine/index.ts";

// --- Planner utilities (pure functions, no Node deps) ---
export {
  totalRuntimeBytes,
  tokensPerSecEstimate,
  weightBytes,
  kvCacheBytes,
} from "./planner/resource.ts";
export { effectiveCapability, qualityRetentionForBpw } from "./planner/quality.ts";
