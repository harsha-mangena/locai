/**
 * MessageBubble — renders a single message with conditional sub-panels.
 *
 * Routes to ReasoningPanel, ToolCallIndicator, MarkdownContent, CitationsPanel
 * based on message fields.
 *
 * Requirements: 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4, 6.5, 13.2, 14.1, 14.2, 14.3, 14.4
 */

import { cn } from "../../lib/utils.ts";
import type { Message } from "../../hooks/useChat.ts";
import { ReasoningPanel } from "./ReasoningPanel.tsx";
import { ToolCallIndicator } from "./ToolCallIndicator.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { CitationsPanel } from "./CitationsPanel.tsx";

interface MessageBubbleProps {
  message: Message;
  /** Whether this is the latest message in the list */
  isLatest?: boolean;
}

export function MessageBubble({ message, isLatest = false }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "rounded-lg px-4 py-3 max-w-[80%] min-w-[60px]",
          isUser ? "bg-bubble-user" : "bg-bubble-assistant"
        )}
      >
        {/* Reasoning panel (assistant only, when thinking trace exists) */}
        {!isUser && message.thinking && (
          <ReasoningPanel thinking={message.thinking} />
        )}

        {/* Tool call indicators (assistant only) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2">
            {message.toolCalls.map((tc) => (
              <ToolCallIndicator key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Main content */}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.answer}</p>
        ) : (
          <>
            <MarkdownContent content={message.answer} />
            {/* Streaming cursor */}
            {message.isStreaming && !message.answer && (
              <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse rounded-sm" />
            )}
          </>
        )}

        {/* Citations panel (assistant only, when citations exist) */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationsPanel citations={message.citations} isLatest={isLatest} />
        )}
      </div>
    </div>
  );
}
