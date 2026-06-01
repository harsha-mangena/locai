/**
 * Terminal renderer for CLI output.
 *
 * Handles streaming output, ANSI colors, diff display, and tool call formatting.
 */

import type { AgentEvent } from "@locai/agent";

const color = {
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

export function printBanner(opts: { projectName: string; serverUrl: string; approvalMode: string; sessionId?: string }) {
  process.stdout.write(`${color.cyan}${color.bold}LocAI${color.reset} ${color.dim}${opts.projectName}${color.reset}\n`);
  process.stdout.write(`${color.dim}server ${opts.serverUrl} · approvals ${opts.approvalMode}${opts.sessionId ? ` · session ${opts.sessionId}` : ""}${color.reset}\n`);
  process.stdout.write(`${color.dim}type /help for commands${color.reset}\n\n`);
}

export function renderEvent(event: AgentEvent) {
  if (event.type === "tool_call") {
    process.stdout.write(`\n${color.cyan}tool${color.reset} ${event.name} ${color.dim}${JSON.stringify(event.arguments)}${color.reset}\n`);
    return;
  }
  if (event.type === "tool_result") {
    process.stdout.write(`${color.green}done${color.reset} ${event.name}\n\n`);
    return;
  }
  if (event.type === "approval_required") {
    return;
  }
  if (event.type === "thinking") {
    process.stdout.write(`${color.dim}${event.content}${color.reset}`);
    return;
  }
  if (event.type === "token") {
    process.stdout.write(event.content);
    return;
  }
  if (event.type === "error") {
    process.stderr.write(`\n${color.red}error${color.reset} ${event.message}\n`);
    return;
  }
  if (event.type === "done") {
    process.stdout.write(`\n${color.dim}iterations ${event.iterations} · approx tokens ${event.tokenCount}${color.reset}\n`);
  }
}

export function printWarning(message: string) {
  process.stderr.write(`${color.yellow}${message}${color.reset}\n`);
}

export function printInfo(message: string) {
  process.stdout.write(`${color.dim}${message}${color.reset}\n`);
}

export function renderApprovalRequest(event: Extract<AgentEvent, { type: "approval_required" }>) {
  process.stdout.write(`\n${color.magenta}${color.bold}approval required${color.reset} ${event.toolName}\n`);
  process.stdout.write(`${event.summary}\n`);
  if (event.diff) {
    process.stdout.write(`${color.dim}${event.diff}${color.reset}\n`);
  } else {
    process.stdout.write(`${color.dim}${JSON.stringify(event.args, null, 2)}${color.reset}\n`);
  }
}

export function renderApprovalResult(result: "approved" | "denied" | "always") {
  const label = result === "denied" ? color.yellow : color.green;
  process.stdout.write(`${label}${result}${color.reset}\n`);
}

export function printReplHelp() {
  process.stdout.write(`
Commands:
  /help        Show this help
  /status      Show current project/session settings
  /danger      Toggle per-action approval prompts for write/shell tools
  /clear       Start a fresh local transcript
  /exit        Leave the REPL

Plain text is sent to the local agent.
`);
}
