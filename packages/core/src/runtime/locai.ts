/**
 * LocAI runtime orchestrator — the one-call API that ties the whole stack
 * together: profile the device, plan the optimal model, resolve+load it on the
 * best engine, and stream tokens.
 *
 *   const ai = await LocAI.create();          // auto profile + plan + load
 *   for await (const t of ai.chat(messages))  // stream
 *
 * The CLI and the OpenAI-compatible server both build on this.
 */

import path from "node:path";
import os from "node:os";
import { profileDevice } from "../profiler/index.ts";
import { plan } from "../planner/index.ts";
import { SEED_CATALOG } from "../catalog/seed.ts";
import { resolveModel } from "../catalog/resolver.ts";
import { EngineRouter, type InferenceEngine } from "../engine/index.ts";
import { LlamaCppEngine } from "../engine/llamacpp.ts";
import { formatPrompt, type ChatMessage } from "../engine/chat-template.ts";
import type { DeviceProfile, RunPlan, ModelDescriptor } from "../types.ts";

export interface LocAIOptions {
  modelsDir?: string;
  serverBin?: string;
  goal?: "quality" | "speed" | "balanced";
  minContext?: number;
  /** Force a specific model id from the catalog (skip auto-select). */
  forceModelId?: string;
}

function defaultServerBin(): string {
  return path.join(
    os.homedir(),
    "Work/locai/vendor/llama.cpp/build/bin/llama-server",
  );
}

export class LocAI {
  readonly device: DeviceProfile;
  readonly runPlan: RunPlan;
  readonly modelPath: string;
  private engine: InferenceEngine;
  private loaded = false;

  private constructor(
    device: DeviceProfile,
    runPlan: RunPlan,
    modelPath: string,
    engine: InferenceEngine,
  ) {
    this.device = device;
    this.runPlan = runPlan;
    this.modelPath = modelPath;
    this.engine = engine;
  }

  /** Auto-profile, auto-plan against locally-available models, and select an engine. */
  static async create(opts: LocAIOptions = {}): Promise<LocAI> {
    const modelsDir = opts.modelsDir ?? path.join(os.homedir(), "Work/locai/models");
    const serverBin = opts.serverBin ?? defaultServerBin();

    const device = profileDevice();

    // Only plan over models we actually have on disk (MVP: no auto-download).
    const available: ModelDescriptor[] = [];
    const pathByModel = new Map<string, string>();
    for (const m of SEED_CATALOG) {
      if (opts.forceModelId && m.id !== opts.forceModelId) continue;
      for (const q of m.quants) {
        const r = resolveModel(m, q, modelsDir);
        if (r.exists) {
          // Keep only quants we have files for, so the planner picks a real one.
          const filtered = { ...m, quants: m.quants.filter((qq) => resolveModel(m, qq, modelsDir).exists) };
          if (!pathByModel.has(m.id)) {
            available.push(filtered);
            pathByModel.set(m.id, r.path);
          }
          break;
        }
      }
    }

    if (available.length === 0) {
      throw new Error(
        `No GGUF models found in ${modelsDir}. Download one (e.g. Llama 3.2 3B Q4_K_M) first.`,
      );
    }

    const result = plan({
      device,
      catalog: available,
      preference: { goal: opts.goal ?? "balanced", minContext: opts.minContext },
    });
    if (!result.best) throw new Error("No feasible plan for available models on this device.");

    const runPlan = result.best;
    const resolved = resolveModel(runPlan.model, runPlan.quant, modelsDir);

    const router = new EngineRouter();
    router.register(
      new LlamaCppEngine({
        serverBin,
        backends: device.platform === "macos" ? ["metal", "cpu"] : ["cuda", "vulkan", "cpu"],
      }),
    );
    const engine = router.resolve(runPlan);
    if (!engine) {
      throw new Error(
        `No engine available for backend "${runPlan.backend}". Is llama-server built at ${serverBin}?`,
      );
    }

    return new LocAI(device, runPlan, resolved.path, engine);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.engine.load(this.runPlan, this.modelPath);
    this.loaded = true;
  }

  /** Stream a chat completion. */
  async *chat(
    messages: ChatMessage[],
    opts: { maxTokens?: number; temperature?: number } = {},
  ): AsyncIterable<string> {
    await this.ensureLoaded();
    const { prompt, stop } = formatPrompt(this.runPlan.model, messages);
    for await (const chunk of this.engine.generate({
      prompt,
      stop,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    })) {
      if (chunk.token) yield chunk.token;
      if (chunk.done) return;
    }
  }

  async close(): Promise<void> {
    await this.engine.unload();
    this.loaded = false;
  }
}
