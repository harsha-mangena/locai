/**
 * @locai/agent — public API surface.
 */

export { AgentRunner, BUILTIN_TOOL_NAMES } from "./runner.ts";
export type { AgentEvent } from "./events.ts";
export type {
  AgentRunnerConfig,
  RunOptions,
  RunResult,
  ToolCallRecord,
  PermissionDecision,
  PermissionRequest,
  PermissionGate,
} from "./types.ts";
export { DESTRUCTIVE_TOOLS, SAFE_TOOLS } from "./types.ts";
