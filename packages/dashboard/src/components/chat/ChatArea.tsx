/**
 * ChatArea — main chat container composing MessageList and ChatInput.
 *
 * Flex column layout filling available space.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7
 */

import { cn } from "../../lib/utils.ts";
import type { Message } from "../../hooks/useChat.ts";
import { MessageList } from "./MessageList.tsx";
import { ChatInput } from "./ChatInput.tsx";

interface ChatAreaProps {
  messages: Message[];
  isGenerating: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
  className?: string;
}

export function ChatArea({
  messages,
  isGenerating,
  onSend,
  onStop,
  className,
}: ChatAreaProps) {
  return (
    <div className={cn("flex flex-col flex-1 overflow-hidden", className)}>
      <MessageList messages={messages} />
      <ChatInput
        onSend={onSend}
        onStop={onStop}
        isGenerating={isGenerating}
      />
    </div>
  );
}
