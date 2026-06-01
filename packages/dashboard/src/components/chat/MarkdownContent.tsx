/**
 * MarkdownContent — renders markdown with syntax-highlighted code blocks.
 *
 * Uses react-markdown with rehype-highlight for code highlighting.
 *
 * Requirements: 4.4
 */

import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { cn } from "../../lib/utils.ts";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  if (!content) return null;

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none break-words", className)}>
      <Markdown rehypePlugins={[rehypeHighlight]}>{content}</Markdown>
    </div>
  );
}
