/**
 * ChatInput — auto-resize textarea with send/stop buttons.
 *
 * Enter sends, Shift+Enter adds newline.
 * Escape triggers stop when generating.
 * SendButton disabled while generating.
 * StopButton visible only while generating.
 *
 * Requirements: 4.1, 4.3, 4.5
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "../../lib/utils.ts";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  isGenerating: boolean;
  className?: string;
}

export function ChatInput({ onSend, onStop, isGenerating, className }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isGenerating) return;
    onSend(trimmed);
    setValue("");
    // Reset height after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isGenerating, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape" && isGenerating) {
        e.preventDefault();
        onStop();
      }
    },
    [handleSend, isGenerating, onStop]
  );

  return (
    <div className={cn("border-t border-foreground/10 px-4 py-3", className)}>
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-foreground/20 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-colors"
          style={{ maxHeight: "200px" }}
          aria-label="Chat message input"
        />
        {isGenerating ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded-lg bg-red-500/90 hover:bg-red-500 text-white p-2 transition-colors"
            aria-label="Stop generating"
            title="Stop generating (Escape)"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!value.trim()}
            className="shrink-0 rounded-lg bg-foreground/90 hover:bg-foreground text-surface p-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
