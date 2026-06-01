/**
 * ToolCallIndicator — collapsible indicator showing tool name, args summary,
 * and paired result when received.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import { useState } from "react";
import { Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import type { ToolCallEvent } from "../../hooks/useChat.ts";

interface ToolCallIndicatorProps {
  toolCall: ToolCallEvent;
  className?: string;
}

export function ToolCallIndicator({ toolCall, className }: ToolCallIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Summarize arguments (first 80 chars of JSON)
  const argsSummary = (() => {
    try {
      const str = JSON.stringify(toolCall.arguments);
      return str.length > 80 ? str.slice(0, 80) + "…" : str;
    } catch {
      return "{}";
    }
  })();

  return (
    <div className={cn("rounded-md bg-tool border border-tool/50 mb-2", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
        aria-expanded={isOpen}
      >
        <Wrench className="h-4 w-4 shrink-0" />
        <span className="font-mono text-xs">{toolCall.name}</span>
        {!isOpen && (
          <span className="text-xs text-foreground/60 truncate max-w-[200px]">
            {argsSummary}
          </span>
        )}
        <span className="ml-auto">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 border-t border-tool/50 pt-2 space-y-2">
          <div>
            <p className="text-xs font-medium text-foreground/60 mb-1">Arguments</p>
            <pre className="text-xs bg-surface/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <p className="text-xs font-medium text-foreground/60 mb-1">Result</p>
              <pre className="text-xs bg-surface/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
