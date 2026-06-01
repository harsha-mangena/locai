/**
 * FitClassBadge — color-coded badge for the plan's fit class.
 *
 * Colors:
 *   comfortable → green
 *   tight → yellow
 *   thrash → orange
 *   over-cliff → red
 *
 * Requirements: 3.4
 */

import { cn } from "../../lib/utils.ts";
import type { FitClass } from "../../api/types.ts";

const fitClassStyles: Record<FitClass, string> = {
  comfortable: "bg-green-500/20 text-green-700 dark:text-green-400",
  tight: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  thrash: "bg-orange-500/20 text-orange-700 dark:text-orange-400",
  "over-cliff": "bg-red-500/20 text-red-700 dark:text-red-400",
};

interface FitClassBadgeProps {
  fitClass: FitClass;
  className?: string;
}

export function FitClassBadge({ fitClass, className }: FitClassBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        fitClassStyles[fitClass],
        className
      )}
    >
      {fitClass}
    </span>
  );
}
