/**
 * Configuration loader for .lai.json / .lai.yaml.
 *
 * Parses persona, autoApprove, customInstructions, serverUrl, and maxIterations.
 */

import fs from "node:fs";
import path from "node:path";

export interface LaiConfig {
  persona?: string;
  autoApprove: string[];
  customInstructions?: string;
  serverUrl: string;
  maxIterations: number;
}

const DEFAULT_CONFIG: LaiConfig = {
  autoApprove: [],
  serverUrl: "http://localhost:8080",
  maxIterations: 10,
};

function parseYamlLite(input: string): Partial<LaiConfig> {
  const result: Record<string, unknown> = {};
  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      result[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^\d+$/.test(rawValue)) {
      result[key] = Number(rawValue);
    } else if (rawValue === "true" || rawValue === "false") {
      result[key] = rawValue === "true";
    } else {
      result[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

export function loadConfig(projectRoot: string): LaiConfig {
  const jsonPath = path.join(projectRoot, ".lai.json");
  const yamlPath = path.join(projectRoot, ".lai.yaml");
  const ymlPath = path.join(projectRoot, ".lai.yml");

  let raw: Partial<LaiConfig> = {};
  if (fs.existsSync(jsonPath)) {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Partial<LaiConfig>;
  } else if (fs.existsSync(yamlPath)) {
    raw = parseYamlLite(fs.readFileSync(yamlPath, "utf8"));
  } else if (fs.existsSync(ymlPath)) {
    raw = parseYamlLite(fs.readFileSync(ymlPath, "utf8"));
  }

  return {
    ...DEFAULT_CONFIG,
    ...raw,
    autoApprove: Array.isArray(raw.autoApprove) ? raw.autoApprove : DEFAULT_CONFIG.autoApprove,
    serverUrl: raw.serverUrl ?? DEFAULT_CONFIG.serverUrl,
    maxIterations: raw.maxIterations ?? DEFAULT_CONFIG.maxIterations,
  };
}
