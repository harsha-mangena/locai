/**
 * Model resolver — maps a (ModelDescriptor, QuantSpec) to a local GGUF file.
 *
 * MVP: resolve against a local models/ directory by convention. In production
 * this is the model hub (download-on-demand with the device-aware "fits?" badge),
 * but the resolver interface stays identical so the engine never changes.
 */

import fs from "node:fs";
import path from "node:path";
import type { ModelDescriptor, QuantSpec } from "../types.ts";

export interface ResolvedModel {
  path: string;
  exists: boolean;
}

/** Conventional filename, e.g. "llama-3.2-3b-instruct-q4_k_m.gguf". */
export function conventionalFilename(model: ModelDescriptor, quant: QuantSpec): string {
  const q = quant.id.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${model.id}-${q}.gguf`;
}

/**
 * Find a GGUF for this (model, quant). Strategy:
 *  1. exact conventional filename
 *  2. any file whose name contains the model id (quant-agnostic fallback)
 */
export function resolveModel(
  model: ModelDescriptor,
  quant: QuantSpec,
  modelsDir: string,
): ResolvedModel {
  const exact = path.join(modelsDir, conventionalFilename(model, quant));
  if (fs.existsSync(exact)) return { path: exact, exists: true };

  if (fs.existsSync(modelsDir)) {
    const idKey = model.id.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    for (const f of fs.readdirSync(modelsDir)) {
      if (!f.toLowerCase().endsWith(".gguf")) continue;
      const norm = f.replace(/[^a-z0-9]+/gi, "").toLowerCase();
      if (norm.includes(idKey) || idKey.includes(norm.slice(0, 12))) {
        return { path: path.join(modelsDir, f), exists: true };
      }
    }
  }
  return { path: exact, exists: false };
}
