/**
 * Coding tools for the local agent.
 *
 * These live in core so the OpenAI-compatible server, CLI, and SDK can share
 * one implementation without creating package cycles.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolRegistry } from "./registry.ts";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 100 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const COMMAND_TIMEOUT_MS = 30_000;

export interface CodingToolsOptions {
  projectRoot: string;
  allowDangerousTools?: boolean;
}

export interface RegisterCodingToolsOptions extends CodingToolsOptions {
  names?: Iterable<string>;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function truncate(value: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + `\n...[truncated ${value.length - max} chars]`;
}

function resolveProjectPath(projectRoot: string, input: unknown): string {
  const requested = String(input ?? ".");
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${requested}`);
  }

  return resolved;
}

function rel(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath) || ".";
}

function readLineRange(content: string, startLine?: unknown, endLine?: unknown): string {
  const start = Math.max(1, Number(startLine) || 1);
  const lines = content.split("\n");
  const end = Math.min(lines.length, Number(endLine) || lines.length);
  return lines.slice(start - 1, end).join("\n");
}

export function makeFileReadTool(projectRoot: string): ToolDefinition {
  return {
    name: "file_read",
    description: "Read a UTF-8 text file inside the project. Supports optional start_line and end_line.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        start_line: { type: "integer", description: "Optional 1-indexed first line." },
        end_line: { type: "integer", description: "Optional 1-indexed final line." },
      },
      required: ["path"],
    },
    async execute(args) {
      try {
        const filePath = resolveProjectPath(projectRoot, args.path);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          return json({ error: "not_a_file", path: rel(projectRoot, filePath) });
        }
        if (stat.size > MAX_FILE_BYTES && !args.start_line && !args.end_line) {
          return json({
            error: "size_exceeded",
            path: rel(projectRoot, filePath),
            sizeBytes: stat.size,
            suggestion: "Use start_line and end_line to read a smaller range.",
          });
        }

        const content = await fs.readFile(filePath, "utf8");
        return json({
          path: rel(projectRoot, filePath),
          content: readLineRange(content, args.start_line, args.end_line),
        });
      } catch (error) {
        return json({
          error: "read_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function makeFileWriteTool(projectRoot: string, allowDangerousTools = false): ToolDefinition {
  return {
    name: "file_write",
    description: "Write full UTF-8 content to a file inside the project. Requires explicit dangerous-tool approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        content: { type: "string", description: "Full file content to write." },
      },
      required: ["path", "content"],
    },
    async execute(args) {
      try {
        if (!allowDangerousTools) {
          return json({
            error: "permission_required",
            tool: "file_write",
            message: "file_write is disabled for this run. Re-run with dangerous tools explicitly approved.",
          });
        }

        const filePath = resolveProjectPath(projectRoot, args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, String(args.content ?? ""), "utf8");
        return json({ ok: true, path: rel(projectRoot, filePath) });
      } catch (error) {
        return json({
          error: "write_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function makeShellExecTool(projectRoot: string, allowDangerousTools = false): ToolDefinition {
  return {
    name: "shell_exec",
    description: "Execute a shell command in the project root. Requires explicit dangerous-tool approval.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
      },
      required: ["command"],
    },
    async execute(args) {
      const command = String(args.command ?? "");
      if (!command.trim()) return json({ error: "invalid_command", message: "command is required" });
      if (!allowDangerousTools) {
        return json({
          error: "permission_required",
          tool: "shell_exec",
          command,
          message: "shell_exec is disabled for this run. Re-run with dangerous tools explicitly approved.",
        });
      }

      try {
        const result = await execAsync(command, {
          cwd: projectRoot,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 512 * 1024,
          shell: process.env.SHELL ?? "/bin/sh",
        });
        return json({
          command,
          exitCode: 0,
          stdout: truncate(result.stdout),
          stderr: truncate(result.stderr),
        });
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message?: string };
        return json({
          command,
          error: err.killed ? "timeout" : undefined,
          exitCode: err.code ?? 1,
          stdout: truncate(err.stdout ?? ""),
          stderr: truncate(err.stderr ?? err.message ?? ""),
        });
      }
    },
  };
}

export function makeGrepSearchTool(projectRoot: string): ToolDefinition {
  return {
    name: "grep_search",
    description: "Search project files with ripgrep. Returns up to 50 matching lines.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for." },
        path: { type: "string", description: "Directory/file inside the project. Defaults to project root." },
        include: { type: "string", description: "Optional glob, for example '*.ts'." },
      },
      required: ["pattern"],
    },
    async execute(args) {
      try {
        const pattern = String(args.pattern ?? "");
        if (!pattern) return json({ error: "invalid_pattern", message: "pattern is required" });
        const searchPath = resolveProjectPath(projectRoot, args.path ?? ".");
        const rgArgs = [
          "--line-number",
          "--column",
          "--no-heading",
          "--color=never",
          "--max-count",
          "50",
        ];
        if (args.include) rgArgs.push("--glob", String(args.include));
        rgArgs.push(pattern, rel(projectRoot, searchPath));

        let stdout = "";
        try {
          const result = await execFileAsync("rg", rgArgs, {
            cwd: projectRoot,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 512 * 1024,
          });
          stdout = result.stdout;
        } catch (error) {
          const err = error as { stdout?: string; code?: number; message?: string };
          if (err.code !== 1) throw new Error(err.message ?? "ripgrep failed");
          stdout = err.stdout ?? "";
        }

        const matches = stdout
          .split("\n")
          .filter(Boolean)
          .slice(0, 50)
          .map((line) => {
            const parts = line.split(":");
            return {
              path: parts[0] ?? "",
              line: Number(parts[1]) || 0,
              column: Number(parts[2]) || 0,
              text: parts.slice(3).join(":"),
            };
          });

        return json({ matches });
      } catch (error) {
        return json({
          error: "grep_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function makeGitStatusTool(projectRoot: string): ToolDefinition {
  return {
    name: "git_status",
    description: "Return concise git status for the project.",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        const result = await execFileAsync("git", ["status", "--short"], {
          cwd: projectRoot,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 256 * 1024,
        });
        return json({ status: result.stdout.split("\n").filter(Boolean) });
      } catch (error) {
        return json({
          error: "git_status_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function makeGitDiffTool(projectRoot: string): ToolDefinition {
  return {
    name: "git_diff",
    description: "Return the unified git diff for the project or an optional path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional path inside the project." },
        staged: { type: "boolean", description: "Show staged diff instead of unstaged diff." },
      },
    },
    async execute(args) {
      try {
        const gitArgs = ["diff"];
        if (args.staged) gitArgs.push("--staged");
        if (args.path) gitArgs.push("--", rel(projectRoot, resolveProjectPath(projectRoot, args.path)));
        const result = await execFileAsync("git", gitArgs, {
          cwd: projectRoot,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 512 * 1024,
        });
        return json({ diff: truncate(result.stdout) });
      } catch (error) {
        return json({
          error: "git_diff_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function makeWebFetchTool(): ToolDefinition {
  return {
    name: "web_fetch",
    description: "Fetch a URL and return text content truncated to a safe size.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
      },
      required: ["url"],
    },
    async execute(args) {
      try {
        const url = new URL(String(args.url ?? ""));
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return json({ error: "invalid_url", message: "Only http and https URLs are allowed." });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          const text = await response.text();
          return json({
            url: url.toString(),
            status: response.status,
            contentType: response.headers.get("content-type"),
            content: truncate(text, 8192),
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        return json({
          error: "web_fetch_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function makeCodingTools(opts: CodingToolsOptions): ToolDefinition[] {
  const root = path.resolve(opts.projectRoot);
  const allowDangerous = opts.allowDangerousTools ?? false;
  return [
    makeFileReadTool(root),
    makeFileWriteTool(root, allowDangerous),
    makeShellExecTool(root, allowDangerous),
    makeGrepSearchTool(root),
    makeGitStatusTool(root),
    makeGitDiffTool(root),
    makeWebFetchTool(),
  ];
}

export function registerCodingTools(
  registry: ToolRegistry,
  opts: RegisterCodingToolsOptions,
): ToolDefinition[] {
  const allow = opts.names ? new Set(opts.names) : null;
  const registered: ToolDefinition[] = [];
  for (const tool of makeCodingTools(opts)) {
    if (allow && !allow.has(tool.name)) continue;
    registry.register(tool);
    registered.push(tool);
  }
  return registered;
}
