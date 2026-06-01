import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makeFileReadTool,
  makeFileWriteTool,
  makeShellExecTool,
} from "./coding.ts";

function withTempDir(fn: (dir: string) => Promise<void> | void) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locai-tools-"));
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("file_read returns requested line range", withTempDir(async (dir) => {
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");

  const tool = makeFileReadTool(dir);
  const result = JSON.parse(await tool.execute({
    path: "a.txt",
    start_line: 2,
    end_line: 3,
  }));

  assert.equal(result.content, "two\nthree");
}));

test("file_read blocks path traversal outside project root", withTempDir(async (dir) => {
  const tool = makeFileReadTool(dir);
  const result = JSON.parse(await tool.execute({ path: "../outside.txt" }));

  assert.equal(result.error, "read_error");
  assert.match(result.message, /escapes project root/);
}));

test("file_write requires explicit dangerous-tool approval", withTempDir(async (dir) => {
  const denied = makeFileWriteTool(dir, false);
  const deniedResult = JSON.parse(await denied.execute({ path: "x.txt", content: "no" }));
  assert.equal(deniedResult.error, "permission_required");

  const allowed = makeFileWriteTool(dir, true);
  const allowedResult = JSON.parse(await allowed.execute({ path: "x.txt", content: "yes" }));
  assert.equal(allowedResult.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, "x.txt"), "utf8"), "yes");
}));

test("shell_exec requires explicit dangerous-tool approval", withTempDir(async (dir) => {
  const denied = makeShellExecTool(dir, false);
  const result = JSON.parse(await denied.execute({ command: "echo hello" }));

  assert.equal(result.error, "permission_required");
}));
