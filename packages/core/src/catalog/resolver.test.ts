import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelDescriptor, QuantSpec } from "../types.ts";
import { conventionalFilename, resolveModel } from "./resolver.ts";

const q4: QuantSpec = {
  family: "gguf",
  id: "Q4_K_M",
  bitsPerWeight: 4.8,
  qualityRetention: 0.94,
};

const q6: QuantSpec = {
  family: "gguf",
  id: "Q6_K",
  bitsPerWeight: 6.5,
  qualityRetention: 0.98,
};

const model: ModelDescriptor = {
  id: "llama-3.2-3b-instruct",
  displayName: "Llama 3.2 3B Instruct",
  paramsB: 3,
  contextLength: 8192,
  gqa: true,
  quants: [q4, q6],
  modalities: ["text"],
  license: "test",
  baseCapability: 0.62,
  chatTemplate: "llama3",
};

function withTempDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locai-resolver-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveModel matches exact conventional filename", () => {
  withTempDir((dir) => {
    const file = path.join(dir, conventionalFilename(model, q4));
    fs.writeFileSync(file, "");

    const resolved = resolveModel(model, q4, dir);

    assert.equal(resolved.exists, true);
    assert.equal(resolved.path, file);
  });
});

test("resolveModel flexible fallback still requires the exact quant", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "Meta-Llama-3.2-3B-Instruct-Q4_K_M.gguf"), "");

    assert.equal(resolveModel(model, q4, dir).exists, true);
    assert.equal(resolveModel(model, q6, dir).exists, false);
  });
});
