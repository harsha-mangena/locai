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
 *
 * Pure node:http — zero dependencies, runs everywhere Node runs.
 */

import http from "node:http";
import { LocAI } from "../runtime/locai.ts";
import type { ChatMessage } from "../engine/chat-template.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
  ai: LocAI;
}

function send(res: http.ServerResponse, code: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
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
  const modelId = ai.runPlan.model.id;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok" });
      }

      // Transparency endpoint — surfaces the auto-plan + rationale.
      if (req.method === "GET" && url.pathname === "/locai/plan") {
        return send(res, 200, {
          device: ai.device.cpu.brand,
          model: ai.runPlan.model.displayName,
          quant: ai.runPlan.quant.id,
          backend: ai.runPlan.backend,
          predicted: ai.runPlan.predicted,
          rationale: ai.runPlan.rationale,
        });
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
        };
        const messages = reqJson.messages ?? [];
        const gen = ai.chat(messages, {
          maxTokens: reqJson.max_tokens,
          temperature: reqJson.temperature,
        });

        const id = "chatcmpl-" + Math.random().toString(36).slice(2);
        const created = Math.floor(Date.now() / 1000);

        if (reqJson.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
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
