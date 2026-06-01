/**
 * MessageList — scrollable message list with auto-scroll to bottom.
 *
 * Uses a scroll container that auto-scrolls when new messages arrive
 * or content updates during streaming.
 *
 * Requirements: 4.2, 4.3
 */

import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils.ts";
import type { Message } from "../../hooks/useChat.ts";
import { MessageBubble } from "./MessageBubble.tsx";

interface MessageListProps {
  messages: Message[];
  className?: string;
}

export function MessageList({ messages, className }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change or content streams in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className={cn("flex-1 overflow-y-auto px-4 py-4", className)}
    >
      <div className="flex flex-col gap-4 max-w-3xl mx-auto">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full min-h-[200px] text-foreground/40 text-sm">
            Start a conversation by typing a message below.
          </div>
        )}
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isLatest={index === messages.length - 1}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
