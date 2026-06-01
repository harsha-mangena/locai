/**
 * useChat — core hook managing the SSE chat stream.
 *
 * Calls api.chatStream(), reads SSE chunks via readSSEStream,
 * parses event types (tool_call, tool_result, token),
 * feeds tokens through ThinkingStreamParser,
 * updates Message[] state incrementally,
 * stores AbortController ref for stop().
 *
 * Returns { messages, isGenerating, send, stop, clear }.
 *
 * Requirements: 2.1, 4.2, 4.5, 6.1, 6.2, 6.3, 6.6
 */

import { useState, useCallback, useRef } from "react";
import { api } from "../api/client.ts";
import { readSSEStream } from "../lib/stream-reader.ts";
import { ThinkingStreamParser } from "../lib/thinking-parser.ts";
import type { ChatMessage } from "../api/types.ts";
import { safeGet } from "../lib/storage.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface Citation {
  title: string;
  url: string;
  snippet: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  thinking?: string;
  answer: string;
  toolCalls?: ToolCallEvent[];
  citations?: Citation[];
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildChatMessages(messages: Message[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.role === "assistant" ? m.answer : m.answer,
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (content: string) => {
    if (isGenerating) return;

    // Add user message
    const userMsg: Message = {
      id: generateMessageId(),
      role: "user",
      answer: content,
    };

    const assistantMsg: Message = {
      id: generateMessageId(),
      role: "assistant",
      answer: "",
      thinking: undefined,
      toolCalls: [],
      citations: [],
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Build the messages array for the API
      const chatMessages = buildChatMessages([...messages, userMsg]);

      // Read settings for temperature/max_tokens
      const settingsObj = safeGet<{ temperature?: number; maxTokens?: number }>(
        "locai-settings",
        { temperature: 0.7, maxTokens: 0 }
      );

      const stream = await api.chatStream(
        {
          messages: chatMessages,
          stream: true,
          temperature: settingsObj.temperature ?? 0.7,
          max_tokens: settingsObj.maxTokens || undefined,
        },
        controller.signal
      );

      const parser = new ThinkingStreamParser();
      let thinkingBuffer = "";
      let answerBuffer = "";
      const toolCalls: ToolCallEvent[] = [];
      const citations: Citation[] = [];

      for await (const sseEvent of readSSEStream(stream)) {
        // Check for [DONE] signal
        if (sseEvent.data === "[DONE]") break;

        // Parse the event type
        if (sseEvent.event === "tool_call") {
          try {
            const data = JSON.parse(sseEvent.data);
            toolCalls.push({
              id: data.id,
              name: data.name,
              arguments: data.arguments,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, toolCalls: [...toolCalls] }
                  : m
              )
            );
          } catch {
            // Ignore malformed tool_call events
          }
        } else if (sseEvent.event === "tool_result") {
          try {
            const data = JSON.parse(sseEvent.data);
            // Match result to the corresponding tool call
            const tc = toolCalls.find((t) => t.id === data.id);
            if (tc) {
              tc.result = data.results;
            }
            // Extract citations from web_search results
            if (data.name === "web_search" && Array.isArray(data.results)) {
              for (const r of data.results) {
                if (r && r.title && r.url) {
                  citations.push({
                    title: r.title,
                    url: r.url,
                    snippet: r.snippet ?? "",
                  });
                }
              }
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, toolCalls: [...toolCalls], citations: [...citations] }
                  : m
              )
            );
          } catch {
            // Ignore malformed tool_result events
          }
        } else {
          // Default: token event
          try {
            const data = JSON.parse(sseEvent.data);
            // OpenAI-compatible format: choices[0].delta.content
            const tokenContent =
              data.choices?.[0]?.delta?.content ??
              data.content ??
              "";

            if (tokenContent) {
              const events = parser.push(tokenContent);
              for (const evt of events) {
                if (evt.type === "thinking_token") {
                  thinkingBuffer += evt.token;
                } else if (evt.type === "answer_token") {
                  answerBuffer += evt.token;
                }
              }

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        thinking: thinkingBuffer || undefined,
                        answer: answerBuffer,
                      }
                    : m
                )
              );
            }

            // Check for stop signal
            if (data.choices?.[0]?.finish_reason || data.stop) {
              break;
            }
          } catch {
            // Ignore malformed token events
          }
        }
      }

      // Flush the parser
      const flushEvents = parser.flush();
      for (const evt of flushEvents) {
        if (evt.type === "thinking_token") {
          thinkingBuffer += evt.token;
        } else if (evt.type === "answer_token") {
          answerBuffer += evt.token;
        }
      }

      // Final update
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                thinking: thinkingBuffer || undefined,
                answer: answerBuffer,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                citations: citations.length > 0 ? citations : undefined,
                isStreaming: false,
              }
            : m
        )
      );
    } catch (err) {
      // If aborted, just finalize the message as-is
      if ((err as Error).name !== "AbortError") {
        // On real errors, mark the message with whatever we have
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, isStreaming: false }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, isStreaming: false }
              : m
          )
        );
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [messages, isGenerating]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setIsGenerating(false);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  return { messages, isGenerating, send, stop, clear };
}
