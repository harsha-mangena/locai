/**
 * @locai/agent — shared types for the Agent SDK.
 */

import type { ToolDefinition } from "@locai/core/tools/registry";

/** Configuration for creating an AgentRunner instance. */
export interface AgentRunnerConfig {
  /** LocAI server URL. Default: "http://localhost:8080" */
  serverUrl?: string;
  /** Custom tools to merge with built-in coding tools. */
  tools?: ToolDefinition[];
  /** Maximum agentic loop iterations. Default: 10 */
  maxIterations?: number;
}

/** Options passed to AgentRunner.run(). */
export interface RunOptions {
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Override max iterations for this run. */
  maxIterations?: number;
  /** System prompt override. */
  systemPrompt?: string;
  /** Project root used by local coding tools. Defaults to the server process cwd. */
  projectRoot?: string;
  /** Explicitly enable file_write and shell_exec for trusted local runs. */
  allowDangerousTools?: boolean;
  /** Ask the client to approve file_write and shell_exec one action at a time. */
  interactiveApprovals?: boolean;
  /** Restrict the server-side tool allow-list for this run. */
  tools?: string[];
}

/** Record of a single tool call made during an agent run. */
export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

/** Result returned when an agent run completes. */
export interface RunResult {
  finalAnswer: string;
  toolCallHistory: ToolCallRecord[];
  iterations: number;
  tokenCount: { prompt: number; completion: number; total: number };
}

/** Permission decision for destructive tool calls. */
export type PermissionDecision = "approve" | "deny" | "always";

/** A request to check permission for a tool call. */
export interface PermissionRequest {
  toolName: string;
  args: Record<string, unknown>;
  /** For file_write: the unified diff of proposed changes. */
  diff?: string;
  /** For file_write: the target file path. */
  targetPath?: string;
}

/** Gate interface for approving/denying destructive tool calls. */
export interface PermissionGate {
  check(request: PermissionRequest): Promise<PermissionDecision>;
}

/** Tools that require permission before execution. */
export const DESTRUCTIVE_TOOLS = new Set(["file_write", "shell_exec"]);

/** Tools that are always safe (read-only). */
export const SAFE_TOOLS = new Set([
  "file_read",
  "grep_search",
  "git_status",
  "git_diff",
  "web_fetch",
]);
