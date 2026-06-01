/**
 * CitationsPanel — collapsible panel showing web search citations.
 *
 * Expanded for the latest message, collapsed for older messages.
 * Each citation is a clickable link opening in a new tab.
 *
 * Requirements: 13.2, 13.3, 13.4, 13.5
 */

import { useState } from "react";
import { Link, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import type { Citation } from "../../hooks/useChat.ts";

interface CitationsPanelProps {
  citations: Citation[];
  /** Whether this is the latest message (expanded by default) */
  isLatest?: boolean;
  className?: string;
}

export function CitationsPanel({ citations, isLatest = false, className }: CitationsPanelProps) {
  const [isOpen, setIsOpen] = useState(isLatest);

  if (!citations || citations.length === 0) return null;

  return (
    <div className={cn("rounded-md border border-foreground/10 mt-2", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
        aria-expanded={isOpen}
      >
        <Link className="h-4 w-4 shrink-0" />
        <span>Sources</span>
        <span className="text-xs text-foreground/60">({citations.length})</span>
        <span className="ml-auto">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 border-t border-foreground/10 pt-2 space-y-2">
          {citations.map((citation, index) => (
            <a
              key={`${citation.url}-${index}`}
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 p-2 rounded hover:bg-surface/50 transition-colors group"
            >
              <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0 text-foreground/50 group-hover:text-foreground/80" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground/90 truncate group-hover:underline">
                  {citation.title}
                </p>
                {citation.snippet && (
                  <p className="text-xs text-foreground/60 line-clamp-2 mt-0.5">
                    {citation.snippet}
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
