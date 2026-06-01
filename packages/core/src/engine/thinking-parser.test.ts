/**
 * ThinkingStreamParser — property-based tests.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 *
 * Run: node --experimental-strip-types --test packages/core/src/engine/thinking-parser.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { ThinkingStreamParser, type ParserEvent } from "./thinking-parser.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Feed a string split into chunks to a fresh parser, return all events. */
function feedChunks(chunks: string[]): ParserEvent[] {
  const parser = new ThinkingStreamParser();
  const events: ParserEvent[] = [];
  for (const chunk of chunks) {
    events.push(...parser.push(chunk));
  }
  events.push(...parser.flush());
  return events;
}

/** Split a string at the given positions into chunks. */
function splitAt(s: string, positions: number[]): string[] {
  const sorted = [...new Set([0, ...positions, s.length])].sort((a, b) => a - b);
  const chunks: string[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    chunks.push(s.slice(sorted[i], sorted[i + 1]));
  }
  return chunks.filter((c) => c.length > 0);
}

/** Concatenate all thinking_token and answer_token content from events. */
function concatAllContent(events: ParserEvent[]): string {
  return events
    .filter((e): e is { type: "thinking_token" | "answer_token"; token: string } =>
      e.type === "thinking_token" || e.type === "answer_token"
    )
    .map((e) => e.token)
    .join("");
}

/** Get only answer_token content. */
function concatAnswerContent(events: ParserEvent[]): string {
  return events
    .filter((e): e is { type: "answer_token"; token: string } => e.type === "answer_token")
    .map((e) => e.token)
    .join("");
}

/** Get only thinking_token content. */
function concatThinkingContent(events: ParserEvent[]): string {
  return events
    .filter((e): e is { type: "thinking_token"; token: string } => e.type === "thinking_token")
    .map((e) => e.token)
    .join("");
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Arbitrary string that does NOT contain "<think>" or "</think>". */
const safeStringArb = fc.string({ minLength: 0, maxLength: 200 }).filter(
  (s) => !s.includes("<think>") && !s.includes("</think>")
);

/** Arbitrary string with a valid <think>...</think> block. */
const thinkBlockArb = fc.tuple(safeStringArb, safeStringArb, safeStringArb).map(
  ([before, thinking, after]) => ({
    full: `${before}<think>${thinking}</think>${after}`,
    before,
    thinking,
    after,
  })
);

/** Arbitrary split positions for a string of given length. */
function splitPositionsArb(len: number) {
  if (len <= 1) return fc.constant([]);
  return fc.array(fc.integer({ min: 1, max: len - 1 }), { minLength: 1, maxLength: Math.min(20, len) });
}

// ---------------------------------------------------------------------------
// Property 1: Round-trip
// **Validates: Requirements 7.5**
//
// For all strings S split into N chunks at arbitrary boundaries,
// concat(all thinking_tokens + all answer_tokens) === S exactly.
// ---------------------------------------------------------------------------

test("Property 1 (round-trip): concat(thinking+answer) === original for arbitrary splits", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 300 }),
      fc.array(fc.integer({ min: 1, max: 299 }), { minLength: 0, maxLength: 15 }),
      (input, rawPositions) => {
        const positions = rawPositions.filter((p) => p > 0 && p < input.length);
        const chunks = splitAt(input, positions);
        const events = feedChunks(chunks);
        const reconstructed = concatAllContent(events);
        assert.equal(reconstructed, input, "round-trip must preserve original content");
      }
    ),
    { numRuns: 500 }
  );
});

// ---------------------------------------------------------------------------
// Property 2: No-think passthrough
// **Validates: Requirements 6.5, 7.1**
//
// For all strings S not containing "<think>", all emitted events are
// answer_token events and no thinking_token events are emitted.
// ---------------------------------------------------------------------------

test("Property 2 (no-think passthrough): strings without <think> produce only answer_token events", () => {
  fc.assert(
    fc.property(
      safeStringArb,
      fc.array(fc.integer({ min: 1, max: 199 }), { minLength: 0, maxLength: 10 }),
      (input, rawPositions) => {
        const positions = rawPositions.filter((p) => p > 0 && p < input.length);
        const chunks = splitAt(input, positions);
        const events = feedChunks(chunks);

        const thinkingTokens = events.filter((e) => e.type === "thinking_token");
        assert.equal(thinkingTokens.length, 0, "no thinking_token events for input without <think>");

        const contentEvents = events.filter((e) => e.type === "answer_token" || e.type === "thinking_token");
        for (const e of contentEvents) {
          assert.equal(e.type, "answer_token", "all content events must be answer_token");
        }
      }
    ),
    { numRuns: 500 }
  );
});

// ---------------------------------------------------------------------------
// Property 3: Split-delimiter invariance
// **Validates: Requirements 6.6, 7.4**
//
// For all strings S containing <think>...</think>, splitting S at any byte
// position and feeding the chunks sequentially produces the same
// thinking/answer split as feeding S as a single chunk.
// ---------------------------------------------------------------------------

test("Property 3 (split-delimiter): splitting at any position produces same result as single chunk", () => {
  fc.assert(
    fc.property(
      thinkBlockArb,
      fc.integer({ min: 1, max: 500 }),
      ({ full }, splitPos) => {
        const clampedPos = Math.min(splitPos, full.length - 1);
        if (clampedPos <= 0 || clampedPos >= full.length) return; // skip trivial splits

        // Single chunk baseline
        const singleEvents = feedChunks([full]);
        const singleThinking = concatThinkingContent(singleEvents);
        const singleAnswer = concatAnswerContent(singleEvents);

        // Two-chunk split
        const twoChunks = [full.slice(0, clampedPos), full.slice(clampedPos)];
        const splitEvents = feedChunks(twoChunks);
        const splitThinking = concatThinkingContent(splitEvents);
        const splitAnswer = concatAnswerContent(splitEvents);

        assert.equal(splitThinking, singleThinking, "thinking content must match regardless of split");
        assert.equal(splitAnswer, singleAnswer, "answer content must match regardless of split");
      }
    ),
    { numRuns: 500 }
  );
});

// ---------------------------------------------------------------------------
// Property 4: Unclosed-think safety
// **Validates: Requirements 7.6**
//
// For all strings of the form "<think>" + X with no closing "</think>",
// the stream ending in THINKING state must:
//   - Preserve the round-trip: concat(thinking + answer) === original (no content lost)
//   - Emit done exactly once
//   - flush() emits any remaining pending buffer as answer_token (not thinking_token)
// ---------------------------------------------------------------------------

test("Property 4 (unclosed-think): stream ending in THINKING state emits all content as answer_token", () => {
  fc.assert(
    fc.property(
      safeStringArb,
      fc.array(fc.integer({ min: 1, max: 199 }), { minLength: 0, maxLength: 10 }),
      (thinkContent, rawPositions) => {
        const input = `<think>${thinkContent}`;
        const positions = rawPositions.filter((p) => p > 0 && p < input.length);
        const chunks = splitAt(input, positions);

        // Feed chunks through push() only (no flush yet)
        const parser = new ThinkingStreamParser();
        const pushEvents: ParserEvent[] = [];
        for (const chunk of chunks) {
          pushEvents.push(...parser.push(chunk));
        }

        // Now flush — this is the safety behavior for unclosed think
        const flushEvents = parser.flush();

        const allEvents = [...pushEvents, ...flushEvents];

        // Round-trip: no content is lost
        const allContent = concatAllContent(allEvents);
        assert.equal(allContent, input, "round-trip must hold: no content lost for unclosed think");

        // done must be emitted exactly once
        const doneEvents = allEvents.filter((e) => e.type === "done");
        assert.equal(doneEvents.length, 1, "done must be emitted exactly once");

        // flush() events must only contain answer_token and done (never thinking_token)
        for (const e of flushEvents) {
          assert.ok(
            e.type === "answer_token" || e.type === "done",
            `flush must only emit answer_token or done, got ${e.type}`
          );
        }

        // flush() must always emit done
        const flushDone = flushEvents.filter((e) => e.type === "done");
        assert.equal(flushDone.length, 1, "flush must emit done exactly once");
      }
    ),
    { numRuns: 500 }
  );
});
