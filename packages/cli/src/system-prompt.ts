/**
 * System prompt builder.
 *
 * Composes the system prompt with role, project context, tool descriptions,
 * and behavioral guidelines.
 */

import type { ProjectContext } from "./context.ts";
import type { LaiConfig } from "./config.ts";

export function buildSystemPrompt(context: ProjectContext, config: LaiConfig): string {
  const persona = config.persona ??
    "You are LocAI's local coding agent: precise, privacy-preserving, and conservative with edits.";

  return [
    persona,
    "Work from evidence. Read files before proposing changes. Prefer small, reversible edits.",
    "Use file_read, grep_search, git_status, and git_diff proactively.",
    "If file_write or shell_exec are disabled, describe the exact edit or command instead of pretending it happened.",
    "When you do change files, explain the outcome and verification briefly.",
    "",
    context.summary,
    config.customInstructions ? `\nProject instructions:\n${config.customInstructions}` : "",
  ].filter(Boolean).join("\n");
}
