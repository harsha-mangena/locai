/**
 * Interactive REPL loop for the LAI CLI.
 *
 * Handles user input, streams tokens, and manages the conversation flow.
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentRunner } from "@locai/agent";
import { renderEvent, printInfo, printReplHelp } from "./renderer.ts";
import { promptApproval, type AskUser } from "./permission.ts";
import {
  appendSessionMessage,
  createSession,
  saveSession,
  sessionTranscript,
  type LaiSession,
} from "./session.ts";

export interface ReplOptions {
  runner: AgentRunner;
  projectRoot: string;
  systemPrompt: string;
  maxIterations: number;
  approvalMode: "interactive" | "allow-dangerous" | "read-only";
  session: LaiSession;
}

function systemPromptWithTranscript(opts: ReplOptions): string {
  const transcript = sessionTranscript(opts.session);
  if (!transcript) return opts.systemPrompt;
  return `${opts.systemPrompt}\n\nRecent local CLI transcript:\n${transcript}`;
}

export async function runTask(task: string, opts: ReplOptions, ask?: AskUser) {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  let finalAnswer = "";
  try {
    opts.runner.removeAllListeners();
    opts.runner.on("tool_call", renderEvent);
    opts.runner.on("tool_result", renderEvent);
    opts.runner.on("approval_required", (event) => {
      promptApproval(opts.runner, event, ask).catch((error) => {
        process.stderr.write(`approval error: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    });
    opts.runner.on("thinking", renderEvent);
    opts.runner.on("token", (event) => {
      if (!event.stop) finalAnswer += event.content;
      renderEvent(event);
    });
    opts.runner.on("error", renderEvent);
    opts.runner.on("done", renderEvent);

    appendSessionMessage(opts.session, "user", task);
    await opts.runner.run(task, {
      signal: controller.signal,
      projectRoot: opts.projectRoot,
      systemPrompt: systemPromptWithTranscript(opts),
      maxIterations: opts.maxIterations,
      allowDangerousTools: opts.approvalMode === "allow-dangerous",
      interactiveApprovals: opts.approvalMode === "interactive",
    });
    appendSessionMessage(opts.session, "assistant", finalAnswer);
    process.stdout.write("\n");
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

export async function runRepl(opts: ReplOptions) {
  const rl = readline.createInterface({ input, output });
  const ask: AskUser = (question) => rl.question(question);
  try {
    while (true) {
      const answer = await rl.question("lai> ");
      const task = answer.trim();
      if (!task) continue;
      if (task === "/exit" || task === "/quit") break;
      if (task === "/help") {
        printReplHelp();
        continue;
      }
      if (task === "/status") {
        printInfo(`project ${opts.projectRoot}`);
        printInfo(`session ${opts.session.id}`);
        printInfo(`approval mode ${opts.approvalMode}`);
        printInfo(`messages ${opts.session.messages.length}`);
        continue;
      }
      if (task === "/danger") {
        opts.approvalMode = opts.approvalMode === "allow-dangerous" ? "interactive" : "allow-dangerous";
        printInfo(`approval mode ${opts.approvalMode}`);
        continue;
      }
      if (task === "/clear") {
        opts.session = createSession(opts.projectRoot, opts.session.projectName);
        saveSession(opts.session);
        printInfo(`new session ${opts.session.id}`);
        continue;
      }
      await runTask(task, opts, ask);
    }
  } finally {
    rl.close();
  }
}
