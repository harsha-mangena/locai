import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AgentRunner } from "./runner.ts";

function onceListening(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      resolve(address!.port);
    });
  });
}

test("AgentRunner parses SSE events and accumulates result", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/locai/agent/run") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "x-locai-task-id": "task_1",
      });
      res.write('event: task_started\ndata: {"taskId":"task_1"}\n\n');
      res.write('event: tool_call\ndata: {"id":"call_1","name":"file_read","arguments":{"path":"README.md"}}\n\n');
      res.write('event: tool_result\ndata: {"id":"call_1","name":"file_read","results":{"content":"hello"}}\n\n');
      res.write('event: token\ndata: {"content":"done","stop":false}\n\n');
      res.write('event: token\ndata: {"content":"","stop":true}\n\n');
      res.write('event: done\ndata: {"finalAnswer":"done","iterations":1}\n\n');
      return res.end();
    }
    res.writeHead(404).end();
  });
  const port = await onceListening(server);
  try {
    const runner = new AgentRunner({ serverUrl: `http://127.0.0.1:${port}` });
    const seen: string[] = [];
    runner.on("tool_call", () => seen.push("tool_call"));
    runner.on("tool_result", () => seen.push("tool_result"));
    runner.on("token", () => seen.push("token"));
    runner.on("done", () => seen.push("done"));

    const result = await runner.run("read");

    assert.deepEqual(seen, ["tool_call", "tool_result", "token", "token", "done"]);
    assert.equal(result.finalAnswer, "done");
    assert.equal(result.iterations, 1);
    assert.equal(result.toolCallHistory[0].result.content, "hello");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("AgentRunner rejects duplicate custom tools", () => {
  const runner = new AgentRunner({
    tools: [
      {
        name: "custom_tool",
        description: "custom",
        parameters: { type: "object" },
        async execute() {
          return "{}";
        },
      },
    ],
  });

  assert.throws(() => runner.registerTool({
    name: "custom_tool",
    description: "duplicate",
    parameters: { type: "object" },
    async execute() {
      return "{}";
    },
  }), /already registered/);
});

test("AgentRunner emits approval_required and can approve actions", async () => {
  let approved = false;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/locai/agent/run") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "x-locai-task-id": "task_approval",
      });
      res.write('event: approval_required\ndata: {"taskId":"task_approval","actionId":"act_1","toolName":"shell_exec","args":{"command":"npm test"},"summary":"Run shell command: npm test"}\n\n');

      const started = Date.now();
      while (!approved && Date.now() - started < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      res.write('event: token\ndata: {"content":"approved","stop":false}\n\n');
      res.write('event: done\ndata: {"finalAnswer":"approved","iterations":0}\n\n');
      return res.end();
    }

    if (req.url === "/locai/agent/approve") {
      let raw = "";
      req.on("data", (chunk) => raw += chunk);
      req.on("end", () => {
        const body = JSON.parse(raw);
        approved = body.taskId === "task_approval" && body.actionId === "act_1" && body.approved === true;
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
      return;
    }

    res.writeHead(404).end();
  });
  const port = await onceListening(server);
  try {
    const runner = new AgentRunner({ serverUrl: `http://127.0.0.1:${port}` });
    runner.on("approval_required", (event) => {
      runner.approve(event.taskId, event.actionId).catch(() => undefined);
    });

    const result = await runner.run("run tests", { interactiveApprovals: true });

    assert.equal(approved, true);
    assert.equal(result.finalAnswer, "approved");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
