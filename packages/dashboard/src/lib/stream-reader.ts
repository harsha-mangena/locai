/**
 * SSE stream reader — async generator that parses Server-Sent Events
 * from a ReadableStream<Uint8Array>.
 *
 * Handles partial chunks across reads and yields parsed events with
 * optional `event` field and required `data` field.
 *
 * Requirements: 2.1 (streaming chat)
 */

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Reads an SSE stream and yields parsed events.
 *
 * SSE format:
 *   event: <type>\n
 *   data: <payload>\n
 *   \n
 *
 * Events are delimited by double newlines. The `event:` line is optional.
 * Multiple `data:` lines within one event are joined with newlines.
 */
export async function* readSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      // Process complete events (delimited by \n\n)
      const events = buffer.split("\n\n");
      // Last element is either empty (if buffer ended with \n\n) or a partial event
      buffer = events.pop() ?? "";

      for (const block of events) {
        if (!block.trim()) continue;

        let event: string | undefined;
        const dataLines: string[] = [];

        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
          // Ignore comments (lines starting with ':') and unknown fields
        }

        if (dataLines.length > 0) {
          yield { event, data: dataLines.join("\n") };
        }
      }

      if (done) break;
    }

    // Process any remaining partial event in the buffer
    if (buffer.trim()) {
      let event: string | undefined;
      const dataLines: string[] = [];

      for (const line of buffer.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length > 0) {
        yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
