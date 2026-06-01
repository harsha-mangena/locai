/**
 * Session persistence manager.
 *
 * Saves and loads conversation sessions to ~/.locai/sessions/.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}

export interface LaiSession {
  id: string;
  projectRoot: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
}

const SESSION_DIR = path.join(os.homedir(), ".locai", "sessions");

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
}

export function createSession(projectRoot: string, projectName: string): LaiSession {
  const now = new Date().toISOString();
  return {
    id: `${slug(projectName)}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    projectRoot,
    projectName,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function sessionPath(id: string): string {
  return path.join(SESSION_DIR, `${id}.json`);
}

export function saveSession(session: LaiSession): void {
  ensureSessionDir();
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
}

export function appendSessionMessage(
  session: LaiSession,
  role: SessionMessage["role"],
  content: string,
): void {
  if (!content.trim()) return;
  session.messages.push({ role, content, at: new Date().toISOString() });
  if (session.messages.length > 40) {
    session.messages.splice(0, session.messages.length - 40);
  }
  saveSession(session);
}

export function loadSession(id: string): LaiSession | null {
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as LaiSession;
}

export function listSessions(): LaiSession[] {
  ensureSessionDir();
  return fs.readdirSync(SESSION_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => loadSession(path.basename(file, ".json")))
    .filter((session): session is LaiSession => session !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadLatestSession(projectRoot: string): LaiSession | null {
  return listSessions().find((session) => session.projectRoot === projectRoot) ?? null;
}

export function sessionTranscript(session: LaiSession): string {
  return session.messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}
