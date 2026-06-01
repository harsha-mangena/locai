/**
 * OpenAI-compatible HTTP server.
 *
 * This is the ecosystem unlock: any tool that speaks the OpenAI API (LangChain,
 * Open WebUI, IDE plugins, SDKs) works against LocAI unchanged, fully offline.
 *
 * Implements the subset the MVP needs:
 *   GET  /v1/models
 *   POST /v1/chat/completions   (stream + non-stream)
 *   GET  /health                (+ /locai/plan for our auto-plan transparency)
 *   GET  /locai/device          (device profile)
 *   GET  /locai/models          (model hub status)
 *   POST /locai/models/download (start a model download)
 *   DELETE /locai/models/:id/:quant (evict a model)
 *
 * Pure node:http — zero dependencies, runs everywhere Node runs.
 */

import http from "node:http";
import { LocAI } from "../runtime/locai.ts";
import { profileDevice } from "../profiler/index.ts";
import type { ChatMessage } from "../engine/chat-template.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { makeWebSearchTool } from "../tools/web-search.ts";
import {
  runAgenticLoop,
  type ChatMessage as AgenticChatMessage,
  type ModelResponse,
} from "./agentic.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
  ai: LocAI;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function send(res: http.ServerResponse, code: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", ...CORS_HEADERS });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export async function serve(opts: ServeOptions): Promise<http.Server> {
  const { ai } = opts;
  const port = opts.port ?? 8080;
  const host = opts.host ?? "127.0.0.1";
  const modelId = ai.runPlan?.model.id ?? "unknown";
  const hub = ai.modelHub;
  const device = ai.device;

  // Initialize tool registry with WebSearchTool at server startup
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(makeWebSearchTool());

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      // Handle OPTIONS preflight for all paths
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok" });
      }

      // Transparency endpoint — surfaces the auto-plan + rationale.
      if (req.method === "GET" && url.pathname === "/locai/plan") {
        if (!ai.runPlan) {
          return send(res, 200, { device: device.cpu.brand, strategy: ai.strategyPlan.strategy });
        }
        return send(res, 200, {
          device: device.cpu.brand,
          model: ai.runPlan.model.displayName,
          quant: ai.runPlan.quant.id,
          backend: ai.runPlan.backend,
          predicted: ai.runPlan.predicted,
          rationale: ai.runPlan.rationale,
        });
      }

      // Device profile endpoint
      if (req.method === "GET" && url.pathname === "/locai/device") {
        return send(res, 200, profileDevice());
      }

      // Model hub status endpoint
      if (req.method === "GET" && url.pathname === "/locai/models") {
        const statuses = hub.status(device);
        return send(res, 200, statuses);
      }

      // Model download endpoint
      if (req.method === "POST" && url.pathname === "/locai/models/download") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { modelId?: string; quantId?: string };
        const { modelId: reqModelId, quantId: reqQuantId } = body;

        if (!reqModelId || !reqQuantId) {
          return send(res, 400, { error: { message: "modelId and quantId are required", type: "invalid_request_error" } });
        }

        // Find the model in the hub's catalog via status
        const statuses = hub.status(device);
        const match = statuses.find((s) => s.model.id === reqModelId && s.quant.id === reqQuantId);

        if (!match) {
          // Check if modelId exists at all
          const modelExists = statuses.some((s) => s.model.id === reqModelId);
          if (!modelExists) {
            return send(res, 404, { error: { message: `model '${reqModelId}' not found`, type: "not_found" } });
          }
          return send(res, 404, { error: { message: `quant '${reqQuantId}' not found for model '${reqModelId}'`, type: "not_found" } });
        }

        // Start the download — we need a DownloadPlan. Construct a minimal one.
        // The hub.download() requires a DownloadPlan with a URL. For the MVP,
        // we construct a HuggingFace URL convention.
        const downloadUrl = `https://huggingface.co/${reqModelId}/resolve/main/${reqModelId}-${reqQuantId.toLowerCase()}.gguf`;
        hub.download(match.model, match.quant, {
          url: downloadUrl,
          sizeBytes: match.sizeBytes,
          resumable: true,
          wifiOnly: false,
        });

        return send(res, 200, { status: "started" });
      }

      // Model eviction endpoint: DELETE /locai/models/:modelId/:quantId
      if (req.method === "DELETE" && url.pathname.startsWith("/locai/models/")) {
        const parts = url.pathname.slice("/locai/models/".length).split("/");
        if (parts.length === 2 && parts[0] && parts[1]) {
          const [reqModelId, reqQuantId] = parts;

          const statuses = hub.status(device);
          const match = statuses.find((s) => s.model.id === reqModelId && s.quant.id === reqQuantId);

          if (!match) {
            const modelExists = statuses.some((s) => s.model.id === reqModelId);
            if (!modelExists) {
              return send(res, 404, { error: { message: `model '${reqModelId}' not found`, type: "not_found" } });
            }
            return send(res, 404, { error: { message: `quant '${reqQuantId}' not found for model '${reqModelId}'`, type: "not_found" } });
          }

          hub.evict(match.model, match.quant);
          return send(res, 200, { status: "deleted" });
        }
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        return send(res, 200, {
          object: "list",
          data: [{ id: modelId, object: "model", owned_by: "locai", created: 0 }],
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const raw = await readBody(req);
        const reqJson = JSON.parse(raw || "{}") as {
          messages: ChatMessage[];
          stream?: boolean;
          max_tokens?: number;
          temperature?: number;
          tools?: Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
        };
        const messages = reqJson.messages ?? [];

        const id = "chatcmpl-" + Math.random().toString(36).slice(2);
        const created = Math.floor(Date.now() / 1000);

        // If request contains tools array, route through the agentic loop
        if (reqJson.tools && reqJson.tools.length > 0) {
          // Resolve tool definitions from the registry based on the request's tools
          const requestedTools = reqJson.tools
            .map((t) => toolRegistry.get(t.function.name))
            .filter((t) => t !== null);

          // Build a callModel callback that uses ai.chat() to call the model
          const callModel = async (
            agenticMessages: AgenticChatMessage[],
            _tools: unknown
          ): Promise<ModelResponse> => {
            // Convert agentic messages to ChatMessage format for ai.chat()
            const chatMessages: ChatMessage[] = agenticMessages.map((m) => ({
              role: m.role as ChatMessage["role"],
              content: m.content ?? "",
            }));

            // Accumulate the full response from the model
            let content = "";
            for await (const token of ai.chat(chatMessages, {
              maxTokens: reqJson.max_tokens,
              temperature: reqJson.temperature,
            })) {
              content += token;
            }

            // For now, the local model doesn't natively produce tool_calls in its output.
            // In a full implementation, we'd parse the model's structured output for tool calls.
            // Return the content as a final answer (no tool_calls).
            return { content, tool_calls: undefined };
          };

          if (reqJson.stream) {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
              ...CORS_HEADERS,
            });

            // Run the agentic loop and stream events
            const loop = runAgenticLoop(
              messages as AgenticChatMessage[],
              requestedTools,
              toolRegistry,
              callModel,
            );

            for await (const event of loop) {
              if (event.event === "tool_call") {
                // Tool call events use event: prefix for SSE
                res.write(`event: tool_call\ndata: ${JSON.stringify(event.data)}\n\n`);
              } else if (event.event === "tool_result") {
                // Tool result events use event: prefix for SSE
                res.write(`event: tool_result\ndata: ${JSON.stringify(event.data)}\n\n`);
              } else if (event.event === "token") {
                // Regular token chunks remain as data: {...} (backward compatible)
                const tokenData = event.data as { content: string; stop: boolean };
                if (tokenData.stop) {
                  // Emit finish_reason stop chunk
                  res.write(
                    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
                  );
                } else if (tokenData.content) {
                  res.write(
                    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: tokenData.content }, finish_reason: null }] })}\n\n`,
                  );
                }
              } else if (event.event === "done") {
                res.write("data: [DONE]\n\n");
              }
            }

            return res.end();
          }

          // Non-streaming agentic path: collect all events and return final answer
          let finalContent = "";
          const loop = runAgenticLoop(
            messages as AgenticChatMessage[],
            requestedTools,
            toolRegistry,
            callModel,
          );

          for await (const event of loop) {
            if (event.event === "token") {
              const tokenData = event.data as { content: string; stop: boolean };
              if (!tokenData.stop && tokenData.content) {
                finalContent += tokenData.content;
              }
            }
          }

          return send(res, 200, {
            id,
            object: "chat.completion",
            created,
            model: modelId,
            choices: [
              { index: 0, message: { role: "assistant", content: finalContent }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        }

        // Standard path (no tools) — backward compatible
        const gen = ai.chat(messages, {
          maxTokens: reqJson.max_tokens,
          temperature: reqJson.temperature,
        });

        if (reqJson.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
            ...CORS_HEADERS,
          });
          // role delta first
          res.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
          );
          for await (const token of gen) {
            res.write(
              `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: token }, finish_reason: null }] })}\n\n`,
            );
          }
          res.write(
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          return res.end();
        }

        // non-streaming: accumulate
        let content = "";
        for await (const token of gen) content += token;
        return send(res, 200, {
          id,
          object: "chat.completion",
          created,
          model: modelId,
          choices: [
            { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }

      send(res, 404, { error: { message: "not found", type: "invalid_request_error" } });
    } catch (e) {
      send(res, 500, { error: { message: String(e), type: "server_error" } });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}
