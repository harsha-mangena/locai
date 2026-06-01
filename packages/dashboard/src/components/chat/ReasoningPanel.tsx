/**
 * ReasoningPanel — collapsible panel showing the model's thinking trace.
 *
 * Default collapsed. Toggle label shows thinking token count.
 *
 * Requirements: 6.4
 */

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils.ts";

interface ReasoningPanelProps {
  thinking: string;
  className?: string;
}

export function ReasoningPanel({ thinking, className }: ReasoningPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!thinking) return null;

  // Approximate token count (split on whitespace)
  const tokenCount = thinking.split(/\s+/).filter(Boolean).length;

  return (
    <div className={cn("rounded-md bg-thinking border border-thinking/50 mb-2", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
        aria-expanded={isOpen}
      >
        <Brain className="h-4 w-4 shrink-0" />
        <span>Thinking</span>
        <span className="text-xs text-foreground/60">({tokenCount} tokens)</span>
        <span className="ml-auto">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 text-sm text-foreground/70 whitespace-pre-wrap border-t border-thinking/50 pt-2">
          {thinking}
        </div>
      )}
    </div>
  );
}
