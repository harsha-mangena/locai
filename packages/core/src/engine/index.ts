/**
 * Engine abstraction — the backend-router contract.
 *
 * This is the interface every inference engine (llama.cpp/ggml, MLX, WebGPU)
 * implements. The orchestration layer (planner, server) depends ONLY on this,
 * never on a concrete engine. That decoupling is what lets one codebase target
 * phone, laptop, desktop, and browser.
 *
 * MVP ships a process-backed llama.cpp engine. Native bindings and MLX/WebGPU
 * engines implement the same interface and are swapped in by the router.
 */

import type { RunPlan, BackendKind } from "../types.ts";

export interface GenerateParams {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
}

export interface GenerateChunk {
  token: string;
  /** Cumulative tokens generated so far. */
  index: number;
  done: boolean;
}

export interface EngineInfo {
  /** Which engine implementation this is. */
  name: string;
  /** Backends this engine can drive on the current device. */
  backends: BackendKind[];
  /** Is the engine actually loadable here (binary/lib present)? */
  available: boolean;
  version?: string;
}

/**
 * The universal inference contract. Keep it minimal: load, stream, unload.
 */
export interface InferenceEngine {
  readonly info: EngineInfo;

  /** Probe whether this engine can run the given plan on this device. */
  supports(plan: RunPlan): boolean;

  /** Load a model according to the plan. Idempotent per plan. */
  load(plan: RunPlan, modelPath: string): Promise<void>;

  /** Stream tokens. Async-iterable so it works in Node, browser, and RN alike. */
  generate(params: GenerateParams): AsyncIterable<GenerateChunk>;

  /** Free resources. */
  unload(): Promise<void>;
}

/**
 * Router: pick the best available engine for a plan. Engines register
 * themselves; the router honours the plan's chosen backend.
 */
export class EngineRouter {
  private engines: InferenceEngine[] = [];

  register(engine: InferenceEngine): this {
    this.engines.push(engine);
    return this;
  }

  /** Find an available engine that supports the plan's backend. */
  resolve(plan: RunPlan): InferenceEngine | null {
    for (const e of this.engines) {
      if (e.info.available && e.info.backends.includes(plan.backend) && e.supports(plan)) {
        return e;
      }
    }
    return null;
  }

  list(): EngineInfo[] {
    return this.engines.map((e) => e.info);
  }
}
