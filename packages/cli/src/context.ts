/**
 * Project context scanner.
 *
 * Detects language, framework, package manager, test runner, and build tool
 * from the project root directory.
 */

import fs from "node:fs";
import path from "node:path";

export interface ProjectContext {
  root: string;
  name: string;
  language: string[];
  framework: string[];
  packageManager?: string;
  testRunner?: string;
  buildTool?: string;
  files: string[];
  summary: string;
}

const ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function findProjectRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (ROOT_MARKERS.some((marker) => exists(path.join(current, marker)))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

function readPackageJson(root: string): Record<string, unknown> | null {
  const file = path.join(root, "package.json");
  if (!exists(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function scanProjectContext(root: string): ProjectContext {
  const files = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "Makefile",
    "README.md",
  ].filter((file) => exists(path.join(root, file)));

  const pkg = readPackageJson(root);
  const deps = {
    ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
  };
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};

  const language = new Set<string>();
  const framework = new Set<string>();

  if (exists(path.join(root, "package.json"))) language.add("JavaScript/TypeScript");
  if (exists(path.join(root, "tsconfig.json"))) language.add("TypeScript");
  if (exists(path.join(root, "pyproject.toml")) || exists(path.join(root, "requirements.txt"))) language.add("Python");
  if (exists(path.join(root, "Cargo.toml"))) language.add("Rust");
  if (exists(path.join(root, "go.mod"))) language.add("Go");

  if (deps.react) framework.add("React");
  if (deps.next) framework.add("Next.js");
  if (deps.vite || exists(path.join(root, "vite.config.ts"))) framework.add("Vite");
  if (deps["@tanstack/react-query"]) framework.add("TanStack Query");

  const packageManager = exists(path.join(root, "pnpm-lock.yaml"))
    ? "pnpm"
    : exists(path.join(root, "yarn.lock"))
      ? "yarn"
      : exists(path.join(root, "package-lock.json"))
        ? "npm"
        : undefined;

  const testRunner = scripts.test
    ? scripts.test
    : deps.vitest
      ? "vitest"
      : deps.jest
        ? "jest"
        : undefined;

  const buildTool = scripts.build
    ? scripts.build
    : deps.vite
      ? "vite"
      : undefined;

  const name = typeof pkg?.name === "string" ? pkg.name : path.basename(root);
  const summary = [
    `Project: ${name}`,
    `Root: ${root}`,
    `Languages: ${Array.from(language).join(", ") || "unknown"}`,
    `Frameworks: ${Array.from(framework).join(", ") || "none detected"}`,
    packageManager ? `Package manager: ${packageManager}` : "",
    testRunner ? `Test: ${testRunner}` : "",
    buildTool ? `Build: ${buildTool}` : "",
    `Key files: ${files.join(", ") || "none detected"}`,
  ].filter(Boolean).join("\n");

  return {
    root,
    name,
    language: Array.from(language),
    framework: Array.from(framework),
    packageManager,
    testRunner,
    buildTool,
    files,
    summary,
  };
}
