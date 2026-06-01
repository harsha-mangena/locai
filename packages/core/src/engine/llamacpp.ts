/**
 * llama.cpp inference engine — the first concrete InferenceEngine.
 *
 * Strategy: drive the prebuilt `llama-server` binary (Metal/CUDA/Vulkan/CPU per
 * build) as a managed child process, translating a RunPlan into CLI flags, and
 * stream tokens over its HTTP completion API. This gives us:
 *   - real GPU-accelerated inference today (no native N-API binding to maintain)
 *   - KV-cache quantization, gpu-layer offload, context, threads from the plan
 *   - a process we fully own (spawn/health-check/unload)
 *
 * The HTTP detail is hidden behind the InferenceEngine contract, so swapping to
 * an in-process N-API binding later changes nothing upstream.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import type {
  InferenceEngine,
  EngineInfo,
  GenerateParams,
  GenerateChunk,
} from "../engine/index.ts";
import type { RunPlan, BackendKind } from "../types.ts";

export interface LlamaCppEngineOptions {
  /** Path to the llama-server binary. */
  serverBin: string;
  /** Host to bind. Default 127.0.0.1. */
  host?: string;
  /** Backends this build supports (from how llama.cpp was compiled). */
  backends?: BackendKind[];
  /** Seconds to wait for server readiness. */
  startupTimeoutSec?: number;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error("no port")));
      }
    });
    srv.on("error", reject);
  });
}

export class LlamaCppEngine implements InferenceEngine {
  readonly info: EngineInfo;
  private opts: Required<LlamaCppEngineOptions>;
  private proc: ChildProcess | null = null;
  private baseUrl = "";
  private loadedPath = "";

  constructor(options: LlamaCppEngineOptions) {
    this.opts = {
      host: "127.0.0.1",
      backends: ["metal", "cuda", "vulkan", "cpu"],
      startupTimeoutSec: 120,
      ...options,
    };
    this.info = {
      name: "llama.cpp (llama-server)",
      backends: this.opts.backends,
      available: fs.existsSync(this.opts.serverBin),
      version: "pinned",
    };
  }

  supports(plan: RunPlan): boolean {
    return this.info.available && this.info.backends.includes(plan.backend);
  }

  async load(plan: RunPlan, modelPath: string): Promise<void> {
    if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
    if (this.proc && this.loadedPath === modelPath) return; // idempotent
    await this.unload();

    const port = await findFreePort();
    this.baseUrl = `http://${this.opts.host}:${port}`;

    const gpuLayers =
      plan.params.gpuLayers === "all" ? 999 : Math.max(0, plan.params.gpuLayers);

    const args = [
      "-m", modelPath,
      "--host", this.opts.host,
      "--port", String(port),
      "-c", String(plan.params.contextLength),
      "-ngl", String(gpuLayers),
      "-t", String(plan.params.threads),
      "--cache-type-k", plan.params.kvCacheType,
      "--cache-type-v", plan.params.kvCacheType,
      "-fa", "on", // flash attention where available
      "--no-webui",
      "--no-ui",
    ];

    this.proc = spawn(this.opts.serverBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.on("exit", () => {
      this.proc = null;
      this.loadedPath = "";
    });

    await this.waitForReady();
    this.loadedPath = modelPath;
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.opts.startupTimeoutSec * 1000;
    while (Date.now() < deadline) {
      if (!this.proc) throw new Error("llama-server exited during startup");
      try {
        const res = await fetch(`${this.baseUrl}/health`);
        if (res.ok) {
          const j = (await res.json()) as { status?: string };
          if (j.status === "ok") return;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("llama-server did not become ready in time");
  }

  async *generate(params: GenerateParams): AsyncIterable<GenerateChunk> {
    if (!this.proc) throw new Error("Engine not loaded — call load() first");

    const body = {
      prompt: params.prompt,
      // -1 = no artificial limit; model stops at its own stop tokens or context ceiling.
      // Only set a limit when the caller explicitly requests one.
      n_predict: params.maxTokens ?? -1,
      temperature: params.temperature ?? 0.7,
      top_p: params.topP ?? 0.95,
      top_k: params.topK ?? 40,
      min_p: params.minP ?? 0.0,
      repeat_penalty: params.repeatPenalty ?? 1.1,
      stop: params.stop ?? [],
      stream: true,
    };

    const res = await fetch(`${this.baseUrl}/completion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error(`completion failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let index = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // llama-server streams SSE: lines starting with "data: ".
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let obj: { content?: string; stop?: boolean };
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        if (obj.content) {
          yield { token: obj.content, index: index++, done: false };
        }
        if (obj.stop) {
          yield { token: "", index, done: true };
          return;
        }
      }
    }
    yield { token: "", index, done: true };
  }

  async unload(): Promise<void> {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      // give it a beat to release the model / Metal context
      await new Promise((r) => setTimeout(r, 200));
      this.proc = null;
      this.loadedPath = "";
    }
  }
}
