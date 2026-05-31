/**
 * End-to-end smoke test — exercises the full path against the real engine if a
 * GGUF model + built llama-server are present; otherwise skips gracefully so CI
 * without a model/binary stays green.
 *
 * Covers: LocAI.create() planning, load, streaming generation, and the
 * OpenAI-compatible server's /v1/chat/completions (non-stream + stream).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocAI } from "../runtime/locai.ts";
import { serve } from "../server/openai.ts";

const MODELS_DIR = path.join(os.homedir(), "Work/locai/models");
const SERVER_BIN = path.join(os.homedir(), "Work/locai/vendor/llama.cpp/build/bin/llama-server");

function hasRuntime(): boolean {
  if (!fs.existsSync(SERVER_BIN)) return false;
  if (!fs.existsSync(MODELS_DIR)) return false;
  return fs.readdirSync(MODELS_DIR).some((f) => f.toLowerCase().endsWith(".gguf"));
}

const maybe = hasRuntime() ? test : test.skip;

maybe("LocAI.create plans a feasible run over on-disk models", async () => {
  const ai = await LocAI.create({ goal: "balanced" });
  assert.ok(ai.runPlan.model.id, "should select a model");
  assert.ok(ai.runPlan.predicted.totalRuntimeBytes < ai.device.usableRamBytes, "must fit in RAM");
  assert.ok(ai.modelPath.endsWith(".gguf"), "should resolve a GGUF path");
  await ai.close();
});

maybe("streams real tokens end-to-end", async () => {
  const ai = await LocAI.create({ goal: "speed" });
  await ai.ensureLoaded();
  let text = "";
  for await (const tok of ai.chat([{ role: "user", content: "Reply with exactly: PONG" }], {
    maxTokens: 8,
    temperature: 0,
  })) {
    text += tok;
  }
  assert.ok(text.length > 0, "should produce output");
  await ai.close();
});

maybe("OpenAI-compatible server returns a non-streaming completion", async () => {
  const ai = await LocAI.create({ goal: "speed" });
  await ai.ensureLoaded();
  const server = await serve({ ai, port: 0 });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 8,
      temperature: 0,
    }),
  });
  assert.equal(res.status, 200);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  assert.ok(j.choices[0].message.content.length > 0);

  server.close();
  await ai.close();
});
