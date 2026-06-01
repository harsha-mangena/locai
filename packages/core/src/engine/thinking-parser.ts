/**
 * ThinkingStreamParser — separates <think>…</think> reasoning traces from
 * the final answer in a streaming token-by-token context.
 *
 * State machine:
 *   IDLE     → sees "<think>"  → THINKING
 *   THINKING → sees "</think>" → ANSWER
 *   ANSWER   → terminal (emits answer_token until done)
 *
 * The key challenge is that SSE chunks can split delimiters across boundaries
 * (e.g. "<thi" + "nk>"). The parser maintains a `pending` buffer that holds
 * characters that MIGHT be the start of a delimiter. Once we can confirm or
 * reject the delimiter, we flush the pending buffer as the appropriate token type.
 *
 * If the stream ends while still in THINKING state (no closing </think>),
 * all buffered content is emitted as answer_token events, then done.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParserEvent =
  | { type: "thinking_token"; token: string }
  | { type: "answer_token"; token: string }
  | { type: "done" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type State = "IDLE" | "THINKING" | "ANSWER";

export class ThinkingStreamParser {
  private state: State = "IDLE";
  private pending = "";

  /**
   * Feed a token (string chunk) into the parser.
   * Returns 0..N events that should be dispatched to the consumer.
   */
  push(token: string): ParserEvent[] {
    const events: ParserEvent[] = [];
    this.pending += token;

    // Process the pending buffer until we can't make further progress
    while (this.pending.length > 0) {
      if (this.state === "IDLE" || this.state === "THINKING") {
        const tag = this.state === "IDLE" ? OPEN_TAG : CLOSE_TAG;
        const result = this.tryConsumeTag(tag);

        if (result === "consumed") {
          // Tag was fully matched and consumed from pending.
          // Emit the tag itself as part of the token stream to preserve
          // the round-trip property (thinking + answer === original).
          if (this.state === "IDLE") {
            events.push({ type: "thinking_token", token: tag });
            this.state = "THINKING";
          } else {
            // THINKING → ANSWER: emit closing tag as thinking_token
            events.push({ type: "thinking_token", token: tag });
            this.state = "ANSWER";
          }
          continue;
        }

        if (result === "partial") {
          // The pending buffer is a prefix of the tag — wait for more data
          break;
        }

        // No match: emit characters up to the next potential tag start.
        // The tag start char is '<' for both open and close tags.
        const nextTagStart = this.pending.indexOf("<", 1);
        const emitEnd = nextTagStart === -1 ? this.pending.length : nextTagStart;
        const chunk = this.pending.slice(0, emitEnd);
        this.pending = this.pending.slice(emitEnd);

        if (this.state === "IDLE") {
          events.push({ type: "answer_token", token: chunk });
        } else {
          events.push({ type: "thinking_token", token: chunk });
        }
      } else {
        // ANSWER state — no more delimiters to look for, emit everything
        events.push({ type: "answer_token", token: this.pending });
        this.pending = "";
        break;
      }
    }

    return events;
  }

  /**
   * Signal end-of-stream. If still in THINKING state, emit all buffered
   * content as answer_token (unclosed think safety), then emit done.
   */
  flush(): ParserEvent[] {
    const events: ParserEvent[] = [];

    if (this.pending.length > 0) {
      // Whatever is left in pending gets emitted as answer_token
      // (covers unclosed <think> and partial delimiters)
      events.push({ type: "answer_token", token: this.pending });
      this.pending = "";
    }

    events.push({ type: "done" });
    this.state = "IDLE";
    return events;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Attempt to match `tag` at the start of `this.pending`.
   *
   * Returns:
   *   "consumed" — tag fully matched and removed from pending
   *   "partial"  — pending is a prefix of tag (need more data)
   *   "no-match" — first char doesn't start the tag
   */
  private tryConsumeTag(tag: string): "consumed" | "partial" | "no-match" {
    // Check if pending starts with the full tag
    if (this.pending.length >= tag.length) {
      if (this.pending.startsWith(tag)) {
        this.pending = this.pending.slice(tag.length);
        return "consumed";
      }
      // Pending is long enough but doesn't match — not a tag
      return "no-match";
    }

    // Pending is shorter than the tag — check if it's a valid prefix
    if (tag.startsWith(this.pending)) {
      return "partial";
    }

    return "no-match";
  }
}
