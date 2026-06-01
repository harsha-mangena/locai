#!/usr/bin/env -S node --experimental-strip-types
/**
 * @locai/cli entry point — the `lai` binary.
 *
 * Parses CLI arguments and launches the REPL or executes a one-shot task.
 */

import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AgentRunner } from "@locai/agent";
import { loadConfig } from "./config.ts";
import { findProjectRoot, scanProjectContext } from "./context.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { printBanner, printInfo, printWarning } from "./renderer.ts";
import { runRepl, runTask } from "./repl.ts";
import {
  createSession,
  listSessions,
  loadLatestSession,
  loadSession,
  saveSession,
} from "./session.ts";

interface CliArgs {
  task?: string;
  serverUrl?: string;
  projectRoot?: string;
  approvalMode: "interactive" | "allow-dangerous" | "read-only";
  maxIterations?: number;
  autoStartServer: boolean;
  resume?: string | true;
  sessions: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    approvalMode: "interactive",
    autoStartServer: true,
    sessions: false,
    help: false,
  };
  const taskParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--server") args.serverUrl = argv[++i];
    else if (arg === "--project") args.projectRoot = argv[++i];
    else if (arg === "--allow-dangerous") args.approvalMode = "allow-dangerous";
    else if (arg === "--read-only") args.approvalMode = "read-only";
    else if (arg === "--no-auto-start") args.autoStartServer = false;
    else if (arg === "--max-iterations") args.maxIterations = Number(argv[++i]);
    else if (arg === "--resume") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) args.resume = argv[++i];
      else args.resume = true;
    }
    else if (arg === "--sessions") args.sessions = true;
    else taskParts.push(arg);
  }

  args.task = taskParts.join(" ").trim() || undefined;
  return args;
}

function printHelp() {
  process.stdout.write(`LocAI CLI

Usage:
  lai [options] "task"
  lai [options]

Options:
  --server URL          LocAI server URL (default: config or http://localhost:8080)
  --project PATH        Project root (default: nearest repo/package root)
  --allow-dangerous     Run file_write and shell_exec without prompting
  --read-only           Never run file_write or shell_exec
  --resume [ID]         Resume the latest session, or a specific session ID
  --sessions            List saved sessions
  --no-auto-start       Do not try to start npm run serve when server is down
  --max-iterations N    Agent loop iteration cap
  -h, --help            Show help

REPL commands:
  /help                 Show REPL commands
  /status               Show session and approval mode
  /danger               Toggle interactive vs always-allow dangerous tools
  /clear                Start a fresh local transcript
  /exit                 Leave the REPL
`);
}

async function checkServer(serverUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${serverUrl}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function workspaceRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

function canStartServerFrom(root: string): boolean {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.serve === "string";
  } catch {
    return false;
  }
}

async function waitForServer(serverUrl: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkServer(serverUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureServer(serverUrl: string, autoStart: boolean): Promise<ChildProcess | null> {
  if (await checkServer(serverUrl)) return null;
  if (!autoStart) return null;

  const root = workspaceRoot();
  if (!canStartServerFrom(root)) return null;

  printInfo("LocAI server is down; starting `npm run serve`...");
  const child = spawn("npm", ["run", "serve"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    if (/listening|server|LocAI/i.test(text)) process.stderr.write(text);
  });
  child.stderr?.on("data", (chunk) => process.stderr.write(String(chunk)));

  if (await waitForServer(serverUrl, 15_000)) {
    return child;
  }

  child.kill();
  return null;
}

function printSessions() {
  const sessions = listSessions();
  if (sessions.length === 0) {
    printInfo("No saved sessions.");
    return;
  }
  for (const session of sessions.slice(0, 20)) {
    process.stdout.write(`${session.id}  ${session.projectName}  ${session.updatedAt}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const projectRoot = path.resolve(args.projectRoot ?? findProjectRoot());
  const config = loadConfig(projectRoot);
  const context = scanProjectContext(projectRoot);

  if (args.sessions) {
    printSessions();
    return;
  }

  const serverUrl = args.serverUrl ?? config.serverUrl;
  const maxIterations = args.maxIterations ?? config.maxIterations;
  let approvalMode = args.approvalMode;
  if (
    approvalMode === "interactive" &&
    (config.autoApprove.includes("file_write") || config.autoApprove.includes("shell_exec"))
  ) {
    approvalMode = "allow-dangerous";
  }

  const resumed = typeof args.resume === "string"
    ? loadSession(args.resume)
    : args.resume === true
      ? loadLatestSession(projectRoot)
      : null;
  const session = resumed ?? createSession(projectRoot, context.name);
  saveSession(session);

  printBanner({
    projectName: context.name,
    serverUrl,
    approvalMode,
    sessionId: session.id,
  });

  const serverProcess = await ensureServer(serverUrl, args.autoStartServer);
  const cleanup = () => serverProcess?.kill();
  process.once("exit", cleanup);

  if (!(await checkServer(serverUrl))) {
    printWarning(`LocAI server is not reachable at ${serverUrl}. Start it with \`npm run serve\` and try again.`);
    process.exitCode = 1;
    return;
  }

  const runner = new AgentRunner({ serverUrl, maxIterations });
  const systemPrompt = buildSystemPrompt(context, config);
  const replOptions = {
    runner,
    projectRoot,
    systemPrompt,
    maxIterations,
    approvalMode,
    session,
  };

  if (args.task) {
    await runTask(args.task, replOptions);
  } else {
    await runRepl(replOptions);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
