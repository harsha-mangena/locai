/**
 * Typed fetch wrappers for the LocAI server API.
 *
 * Base URL is read from localStorage settings (default http://localhost:8080).
 * Requirements: 2.1, 2.4
 */

import type {
  ChatRequest,
  DeviceProfile,
  ModelStatus,
  PlanResponse,
} from "./types.ts";
import { safeGet } from "../lib/storage.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  return safeGet<string>("locai-settings-serverUrl", "http://localhost:8080");
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

export const api = {
  /** GET /health — server liveness check. */
  health(): Promise<{ status: string }> {
    return fetchJSON<{ status: string }>("/health");
  },

  /** GET /locai/plan — current auto-plan rationale. */
  getPlan(): Promise<PlanResponse> {
    return fetchJSON<PlanResponse>("/locai/plan");
  },

  /** GET /locai/device — hardware profile of the server machine. */
  getDevice(): Promise<DeviceProfile> {
    return fetchJSON<DeviceProfile>("/locai/device");
  },

  /** GET /locai/models — model hub status array. */
  getModels(): Promise<ModelStatus[]> {
    return fetchJSON<ModelStatus[]>("/locai/models");
  },

  /** POST /locai/models/download — start a model download. */
  downloadModel(modelId: string, quantId: string): Promise<{ status: string }> {
    return fetchJSON<{ status: string }>("/locai/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, quantId }),
    });
  },

  /** DELETE /locai/models/:modelId/:quantId — evict a downloaded model. */
  deleteModel(modelId: string, quantId: string): Promise<{ status: string }> {
    return fetchJSON<{ status: string }>(
      `/locai/models/${encodeURIComponent(modelId)}/${encodeURIComponent(quantId)}`,
      { method: "DELETE" }
    );
  },

  /**
   * POST /v1/chat/completions with stream: true.
   * Returns a ReadableStream of raw bytes for SSE parsing.
   */
  chatStream(
    req: ChatRequest,
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    return fetch(`${getBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, stream: true }),
      signal,
    }).then((res) => {
      if (!res.ok) {
        throw new Error(`Chat API ${res.status}: ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error("Chat API returned no body");
      }
      return res.body;
    });
  },
};
