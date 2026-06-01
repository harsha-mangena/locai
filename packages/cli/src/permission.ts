/**
 * Permission gate for destructive tool calls.
 *
 * Prompts the user for approval before executing file_write or shell_exec.
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentRunner, type AgentEvent } from "@locai/agent";
import { renderApprovalRequest, renderApprovalResult } from "./renderer.ts";

type ApprovalEvent = Extract<AgentEvent, { type: "approval_required" }>;

export type AskUser = (question: string) => Promise<string>;

export async function promptApproval(
  runner: AgentRunner,
  event: ApprovalEvent,
  ask?: AskUser,
): Promise<void> {
  renderApprovalRequest(event);

  let closeRl: (() => void) | undefined;
  const question = ask ?? (async (prompt: string) => {
    const rl = readline.createInterface({ input, output });
    closeRl = () => rl.close();
    return rl.question(prompt);
  });

  try {
    const answer = (await question("Approve? [y]es / [n]o / [a]lways: ")).trim().toLowerCase();
    if (answer === "a" || answer === "always") {
      await runner.approve(event.taskId, event.actionId, { always: true });
      renderApprovalResult("always");
      return;
    }
    if (answer === "y" || answer === "yes") {
      await runner.approve(event.taskId, event.actionId);
      renderApprovalResult("approved");
      return;
    }

    await runner.deny(event.taskId, event.actionId);
    renderApprovalResult("denied");
  } catch (error) {
    await runner.deny(event.taskId, event.actionId).catch(() => undefined);
    throw error;
  } finally {
    closeRl?.();
  }
}
