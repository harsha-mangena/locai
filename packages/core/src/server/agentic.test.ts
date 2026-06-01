/**
 * AgenticLoop — property-based tests.
 *
 * Validates: Requirements 11.1, 11.3, 11.4, 11.5
 *
 * Run: node --experimental-strip-types --test packages/core/src/server/agentic.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { ToolRegistry, type ToolDefinition } from "../tools/registry.ts";
import {
  runAgenticLoop,
  type ChatMessage,
  type ModelResponse,
  type AgenticSSEEvent,
} from "./agentic.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all events from the async generator into an array. */
async function collectEvents(
  gen: AsyncGenerator<AgenticSSEEvent>
): Promise<AgenticSSEEvent[]> {
  const events: AgenticSSEEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Create a registry with a simple echo tool. */
function makeRegistryWithEchoTool(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "Echoes back the arguments",
    parameters: { type: "object", properties: { input: { type: "string" } } },
    async execute(args) {
      return JSON.stringify({ result: args });
    },
  });
  return registry;
}

/** Create a mock callModel that always returns tool_calls. */
function makeAlwaysToolCallModel(): (
  messages: ChatMessage[],
  tools: unknown
) => Promise<ModelResponse> {
  return async (_messages, _tools) => ({
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "echo",
          arguments: JSON.stringify({ input: "test" }),
        },
      },
    ],
  });
}

/** Create a mock callModel that returns a final answer (no tool_calls). */
function makeFinalAnswerModel(
  answer: string
): (messages: ChatMessage[], tools: unknown) => Promise<ModelResponse> {
  return async (_messages, _tools) => ({
    content: answer,
    tool_calls: undefined,
  });
}

/** Create a mock callModel that returns empty tool_calls array. */
function makeEmptyToolCallsModel(
  answer: string
): (messages: ChatMessage[], tools: unknown) => Promise<ModelResponse> {
  return async (_messages, _tools) => ({
    content: answer,
    tool_calls: [],
  });
}

// ---------------------------------------------------------------------------
// Property 1 (termination bound): mock model always returning tool_calls →
// loop emits `done` after ≤ maxIterations
// **Validates: Requirements 11.4, 11.5**
// ---------------------------------------------------------------------------

test("Property 1 (termination bound): loop emits done after ≤ maxIterations when model always returns tool_calls", async () => {
  const registry = makeRegistryWithEchoTool();
  const tools: ToolDefinition[] = [registry.get("echo")!];
  const callModel = makeAlwaysToolCallModel();

  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 10 }),
      async (maxIterations) => {
        const messages: ChatMessage[] = [
          { role: "user", content: "test" },
        ];

        const events = await collectEvents(
          runAgenticLoop(messages, tools, registry, callModel, {
            maxIterations,
          })
        );

        // Must emit exactly one "done" event
        const doneEvents = events.filter((e) => e.event === "done");
        assert.equal(
          doneEvents.length,
          1,
          "must emit exactly one done event"
        );

        // Count tool_call events — each iteration produces one tool_call
        const toolCallEvents = events.filter((e) => e.event === "tool_call");
        assert.ok(
          toolCallEvents.length <= maxIterations,
          `tool_call events (${toolCallEvents.length}) must be ≤ maxIterations (${maxIterations})`
        );

        // The loop must have terminated (done is the last event)
        assert.equal(
          events[events.length - 1].event,
          "done",
          "last event must be done"
        );
      }
    ),
    { numRuns: 50 }
  );
});

// ---------------------------------------------------------------------------
// Property 2 (no-tools fast path): request without tools → no `tool_call`
// events emitted, `done` emitted
// **Validates: Requirements 11.1, 11.3**
// ---------------------------------------------------------------------------

test("Property 2 (no-tools fast path): request without tools emits no tool_call events and emits done", async () => {
  const registry = new ToolRegistry();

  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 200 }),
      async (answer) => {
        const callModel = makeFinalAnswerModel(answer);
        const messages: ChatMessage[] = [
          { role: "user", content: "hello" },
        ];

        // Test with undefined tools
        const eventsUndefined = await collectEvents(
          runAgenticLoop(messages, undefined, registry, callModel)
        );

        // No tool_call events
        const toolCallEvents = eventsUndefined.filter(
          (e) => e.event === "tool_call"
        );
        assert.equal(
          toolCallEvents.length,
          0,
          "no tool_call events when tools is undefined"
        );

        // Must emit done
        const doneEvents = eventsUndefined.filter((e) => e.event === "done");
        assert.equal(doneEvents.length, 1, "must emit exactly one done event");

        // Test with empty tools array
        const eventsEmpty = await collectEvents(
          runAgenticLoop(messages, [], registry, callModel)
        );

        const toolCallEventsEmpty = eventsEmpty.filter(
          (e) => e.event === "tool_call"
        );
        assert.equal(
          toolCallEventsEmpty.length,
          0,
          "no tool_call events when tools is empty array"
        );

        const doneEventsEmpty = eventsEmpty.filter((e) => e.event === "done");
        assert.equal(
          doneEventsEmpty.length,
          1,
          "must emit exactly one done event with empty tools"
        );
      }
    ),
    { numRuns: 50 }
  );
});

// ---------------------------------------------------------------------------
// Test: empty tool_calls array in model response treated as final answer
// **Validates: Requirements 11.3**
// ---------------------------------------------------------------------------

test("Empty tool_calls array in model response is treated as final answer", async () => {
  const registry = makeRegistryWithEchoTool();
  const tools: ToolDefinition[] = [registry.get("echo")!];
  const answer = "This is the final answer";
  const callModel = makeEmptyToolCallsModel(answer);

  const messages: ChatMessage[] = [{ role: "user", content: "test" }];

  const events = await collectEvents(
    runAgenticLoop(messages, tools, registry, callModel)
  );

  // No tool_call events should be emitted
  const toolCallEvents = events.filter((e) => e.event === "tool_call");
  assert.equal(
    toolCallEvents.length,
    0,
    "no tool_call events when model returns empty tool_calls array"
  );

  // Should emit token events with the answer content
  const tokenEvents = events.filter((e) => e.event === "token");
  assert.ok(tokenEvents.length >= 1, "must emit at least one token event");

  // The content token should contain the answer
  const contentToken = tokenEvents.find(
    (e) => e.event === "token" && (e as any).data.content === answer
  );
  assert.ok(contentToken, "must emit a token event with the answer content");

  // Must emit a stop token
  const stopToken = tokenEvents.find(
    (e) => e.event === "token" && (e as any).data.stop === true
  );
  assert.ok(stopToken, "must emit a stop token");

  // Must emit done
  const doneEvents = events.filter((e) => e.event === "done");
  assert.equal(doneEvents.length, 1, "must emit exactly one done event");

  // Done must be the last event
  assert.equal(events[events.length - 1].event, "done", "last event must be done");
});
