import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "./openai.ts";
import { profileDevice } from "../profiler/index.ts";

function makeFakeAI(projectRoot: string) {
  let calls = 0;
  return {
    runPlan: { model: { id: "fake-local-model" } },
    strategyPlan: { strategy: "native-local" },
    modelHub: { status: () => [] },
    device: profileDevice(),
    async *chat() {
      calls++;
      if (calls === 1) {
        yield '<locai_tool_calls>[{"name":"file_read","arguments":{"path":"README.md"}}]</locai_tool_calls>';
      } else {
        yield `Read ${path.basename(projectRoot)}.`;
      }
    },
  };
}

function makeFakeWriteAI() {
  let calls = 0;
  return {
    runPlan: { model: { id: "fake-local-model" } },
    strategyPlan: { strategy: "native-local" },
    modelHub: { status: () => [] },
    device: profileDevice(),
    async *chat() {
      calls++;
      if (calls === 1) {
        yield '<locai_tool_calls>[{"name":"file_write","arguments":{"path":"out.txt","content":"approved write"}}]</locai_tool_calls>';
      } else {
        yield "Write complete.";
      }
    },
  };
}

test("POST /locai/agent/run streams tool events and final answer", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "locai-agent-server-"));
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# Demo\n");

  const server = await serve({ ai: makeFakeAI(projectRoot) as never, port: 0 });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/locai/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "Read the README",
        projectRoot,
        tools: ["file_read"],
        maxIterations: 2,
      }),
    });

    assert.equal(response.status, 200);
    assert.ok(response.headers.get("x-locai-task-id"));

    const text = await response.text();
    assert.match(text, /event: tool_call/);
    assert.match(text, /event: tool_result/);
    assert.match(text, /event: done/);
    assert.match(text, /Read locai-agent-server-/);
  } finally {
    server.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("POST /locai/agent/run pauses for interactive approval before writing", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "locai-agent-approval-"));
  const server = await serve({ ai: makeFakeWriteAI() as never, port: 0 });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/locai/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "Write out.txt",
        projectRoot,
        tools: ["file_write"],
        approvalMode: "interactive",
        maxIterations: 2,
      }),
    });

    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let approved = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });

      if (!approved && text.includes("event: approval_required")) {
        const match = text.match(/event: approval_required\ndata: (.+)\n\n/);
        if (match) {
          const approval = JSON.parse(match[1]) as { taskId: string; actionId: string };
          const approvalResponse = await fetch(`http://127.0.0.1:${port}/locai/agent/approve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              taskId: approval.taskId,
              actionId: approval.actionId,
              approved: true,
            }),
          });
          assert.equal(approvalResponse.status, 200);
          approved = true;
        }
      }
    }

    assert.equal(fs.readFileSync(path.join(projectRoot, "out.txt"), "utf8"), "approved write");
    assert.match(text, /event: approval_required/);
    assert.match(text, /event: tool_result/);
    assert.match(text, /Write complete/);
  } finally {
    server.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
