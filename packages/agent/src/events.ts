/**
 * @locai/agent — typed event definitions for the agentic loop.
 */

/** Discriminated union of all events emitted by AgentRunner during a run. */
export type AgentEvent =
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequiredEvent
  | TokenEvent
  | ThinkingEvent
  | ErrorEvent
  | DoneEvent;

export interface ToolCallEvent {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  id: string;
  name: string;
  result: unknown;
}

export interface ApprovalRequiredEvent {
  type: "approval_required";
  taskId: string;
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  targetPath?: string;
  diff?: string;
}

export interface TokenEvent {
  type: "token";
  content: string;
  stop: boolean;
}

export interface ThinkingEvent {
  type: "thinking";
  content: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
}

export interface DoneEvent {
  type: "done";
  finalAnswer: string;
  iterations: number;
  tokenCount: number;
}
