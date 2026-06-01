/**
 * ToolExecutor — property-based tests.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 *
 * Run: node --experimental-strip-types --test packages/core/src/tools/executor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { ToolRegistry, type ToolDefinition } from "./registry.ts";
import { ToolExecutor, type ToolCall } from "./executor.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a registry with a single echo tool that returns its args as JSON. */
function makeRegistryWithEchoTool(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "Echoes back the arguments as JSON",
    parameters: { type: "object", properties: { input: { type: "string" } } },
    async execute(args) {
      return JSON.stringify({ result: args });
    },
  });
  return registry;
}

/** Create a registry with a tool that always throws. */
function makeRegistryWithThrowingTool(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "thrower",
    description: "Always throws an error",
    parameters: { type: "object", properties: {} },
    async execute(_args) {
      throw new Error("intentional failure");
    },
  });
  return registry;
}

/** Parse a result string as JSON safely, returning null on failure. */
function tryParseJSON(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Arbitrary tool name that is NOT "echo" or "thrower" (guaranteed unknown). */
const unknownToolNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s !== "echo" && s !== "thrower");

/** Arbitrary string that is NOT valid JSON. */
const malformedJsonArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  });

/** Arbitrary valid JSON object as a string. */
const validJsonObjectArb = fc
  .dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.jsonValue())
  .map((obj) => JSON.stringify(obj));

/** Arbitrary tool call ID. */
const toolCallIdArb = fc.string({ minLength: 1, maxLength: 30 });

// ---------------------------------------------------------------------------
// Property 1: Unknown tool → resolves with JSON string containing "error" key, never rejects
// **Validates: Requirements 10.4**
// ---------------------------------------------------------------------------

test("Property 1 (unknown tool): resolves with JSON error string, never rejects", async () => {
  const registry = makeRegistryWithEchoTool();
  const executor = new ToolExecutor(registry);

  await fc.assert(
    fc.asyncProperty(
      toolCallIdArb,
      unknownToolNameArb,
      validJsonObjectArb,
      async (id, name, args) => {
        const toolCall: ToolCall = { id, name, arguments: args };

        // Must resolve, never reject
        const result = await executor.execute(toolCall);

        // Result must be a valid JSON string
        const parsed = tryParseJSON(result);
        assert.notEqual(parsed, null, "result must be valid JSON");

        // Must contain an "error" key
        assert.ok(
          typeof parsed === "object" && parsed !== null && "error" in parsed,
          'result must contain an "error" key'
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 2: Malformed JSON args → resolves with JSON string containing "error" key, never rejects
// **Validates: Requirements 10.2**
// ---------------------------------------------------------------------------

test("Property 2 (malformed JSON args): resolves with JSON error string, never rejects", async () => {
  const registry = makeRegistryWithEchoTool();
  const executor = new ToolExecutor(registry);

  await fc.assert(
    fc.asyncProperty(
      toolCallIdArb,
      malformedJsonArb,
      async (id, badArgs) => {
        const toolCall: ToolCall = { id, name: "echo", arguments: badArgs };

        // Must resolve, never reject
        const result = await executor.execute(toolCall);

        // Result must be a valid JSON string
        const parsed = tryParseJSON(result);
        assert.notEqual(parsed, null, "result must be valid JSON");

        // Must contain an "error" key
        assert.ok(
          typeof parsed === "object" && parsed !== null && "error" in parsed,
          'result must contain an "error" key'
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Property 3: Throwing execute fn → resolves with JSON string containing "error" key, never rejects
// **Validates: Requirements 10.3**
// ---------------------------------------------------------------------------

test("Property 3 (throwing execute fn): resolves with JSON error string, never rejects", async () => {
  const registry = makeRegistryWithThrowingTool();
  const executor = new ToolExecutor(registry);

  await fc.assert(
    fc.asyncProperty(
      toolCallIdArb,
      validJsonObjectArb,
      async (id, args) => {
        const toolCall: ToolCall = { id, name: "thrower", arguments: args };

        // Must resolve, never reject
        const result = await executor.execute(toolCall);

        // Result must be a valid JSON string
        const parsed = tryParseJSON(result);
        assert.notEqual(parsed, null, "result must be valid JSON");

        // Must contain an "error" key
        assert.ok(
          typeof parsed === "object" && parsed !== null && "error" in parsed,
          'result must contain an "error" key'
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Sequential execution: multiple tool_calls in one response are executed in order
// **Validates: Requirements 10.5**
// ---------------------------------------------------------------------------

test("Sequential execution: multiple tool_calls are executed in order and all resolve", async () => {
  const executionOrder: string[] = [];

  const registry = new ToolRegistry();
  registry.register({
    name: "tracker",
    description: "Tracks execution order",
    parameters: { type: "object", properties: { index: { type: "number" } } },
    async execute(args) {
      const idx = String(args.index);
      executionOrder.push(idx);
      // Small delay to verify sequential behavior
      await new Promise((resolve) => setTimeout(resolve, 5));
      return JSON.stringify({ executed: idx });
    },
  });

  const executor = new ToolExecutor(registry);

  const toolCalls: ToolCall[] = [
    { id: "call_1", name: "tracker", arguments: JSON.stringify({ index: 0 }) },
    { id: "call_2", name: "tracker", arguments: JSON.stringify({ index: 1 }) },
    { id: "call_3", name: "tracker", arguments: JSON.stringify({ index: 2 }) },
    { id: "call_4", name: "tracker", arguments: JSON.stringify({ index: 3 }) },
    { id: "call_5", name: "tracker", arguments: JSON.stringify({ index: 4 }) },
  ];

  // Execute sequentially (as required by 10.5)
  const results: string[] = [];
  for (const tc of toolCalls) {
    results.push(await executor.execute(tc));
  }

  // All must resolve successfully
  assert.equal(results.length, 5);
  for (const r of results) {
    const parsed = tryParseJSON(r);
    assert.notEqual(parsed, null, "each result must be valid JSON");
    assert.ok(
      typeof parsed === "object" && parsed !== null && "executed" in parsed,
      "each result must contain executed key"
    );
  }

  // Execution order must be sequential
  assert.deepEqual(executionOrder, ["0", "1", "2", "3", "4"]);
});
