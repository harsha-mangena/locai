import test from "node:test";
import assert from "node:assert/strict";
import type { OpenAITool } from "../tools/registry.ts";
import { parseModelToolResponse, toEngineMessages } from "./tool-calling.ts";
import type { ChatMessage as AgenticChatMessage } from "./agentic.ts";

const tools: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web",
      parameters: { type: "object" },
    },
  },
];

test("parseModelToolResponse parses tagged tool calls", () => {
  const response = parseModelToolResponse(
    '<locai_tool_calls>[{"name":"web_search","arguments":{"query":"locai"}}]</locai_tool_calls>',
    tools,
  );

  assert.equal(response.content, null);
  assert.equal(response.tool_calls?.length, 1);
  assert.equal(response.tool_calls?.[0].function.name, "web_search");
  assert.equal(response.tool_calls?.[0].function.arguments, '{"query":"locai"}');
});

test("parseModelToolResponse ignores unknown tool names and keeps text final", () => {
  const content = '<locai_tool_calls>[{"name":"shell_exec","arguments":{"command":"rm -rf ."}}]</locai_tool_calls>';
  const response = parseModelToolResponse(content, tools);

  assert.equal(response.content, content);
  assert.equal(response.tool_calls, undefined);
});

test("parseModelToolResponse supports OpenAI-shaped JSON", () => {
  const response = parseModelToolResponse(
    JSON.stringify({
      tool_calls: [
        {
          id: "abc",
          type: "function",
          function: { name: "web_search", arguments: '{"query":"pmf"}' },
        },
      ],
    }),
    tools,
  );

  assert.equal(response.tool_calls?.[0].id, "abc");
  assert.equal(response.tool_calls?.[0].function.arguments, '{"query":"pmf"}');
});

test("toEngineMessages converts tool role into user-readable tool result", () => {
  const messages: AgenticChatMessage[] = [
    { role: "user", content: "Search this" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "web_search", arguments: '{"query":"locai"}' },
        },
      ],
    },
    { role: "tool", content: '[{"title":"LocAI"}]', tool_call_id: "call_1" },
  ];

  const converted = toEngineMessages(messages, tools);

  assert.equal(converted[0].role, "system");
  assert.equal(converted.at(-1)?.role, "user");
  assert.match(converted.at(-1)?.content ?? "", /Tool result for call_1/);
});
