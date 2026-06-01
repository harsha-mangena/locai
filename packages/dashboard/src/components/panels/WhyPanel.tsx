/**
 * WhyPanel — displays the auto-plan rationale: model badge, fit class,
 * metrics, and rationale list.
 *
 * Shows skeleton while loading, error message on failure.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { Cpu, Gauge, Sparkles } from "lucide-react";
import { useLocaiPlan } from "../../hooks/useLocaiPlan.ts";
import { FitClassBadge } from "../ui/FitClassBadge.tsx";
import { cn } from "../../lib/utils.ts";

export function WhyPanel() {
  const { plan, isLoading, error } = useLocaiPlan();

  if (isLoading) {
    return <WhyPanelSkeleton />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        {plan && <WhyPanelContent plan={plan} />}
        <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">
            Failed to load plan: {error.message}
          </p>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <p className="text-sm text-foreground/50">
        No plan data available. Ensure the LocAI server is running.
      </p>
    );
  }

  return <WhyPanelContent plan={plan} />;
}

function WhyPanelContent({ plan }: { plan: NonNullable<ReturnType<typeof useLocaiPlan>["plan"]> }) {
  return (
    <div className="space-y-4">
      {/* Model Badge */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase text-foreground/50">
          Active Model
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {plan.model.displayName}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-foreground/70 dark:bg-gray-800">
            {plan.quant.id}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-foreground/70 dark:bg-gray-800">
            {plan.backend}
          </span>
        </div>
      </div>

      {/* Fit Class Badge */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase text-foreground/50">
          Fit Class
        </h3>
        <FitClassBadge fitClass={plan.predicted.fitClass} />
      </div>

      {/* Metrics Row */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase text-foreground/50">
          Predicted Metrics
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="tok/s"
            value={plan.predicted.tokensPerSecEstimate.toFixed(1)}
          />
          <MetricCard
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="memory"
            value={`${Math.round(plan.predicted.memoryPressure * 100)}%`}
          />
          <MetricCard
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="quality"
            value={`${Math.round(plan.predicted.qualityRetention * 100)}%`}
          />
        </div>
      </div>

      {/* Rationale List */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase text-foreground/50">
          Rationale
        </h3>
        <ul className="space-y-1">
          {plan.rationale.map((entry, i) => (
            <li
              key={i}
              className="text-sm text-foreground/80 leading-snug"
            >
              • {entry}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-gray-200 p-2 dark:border-gray-700">
      <div className="flex items-center gap-1 text-foreground/60">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function WhyPanelSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Model badge skeleton */}
      <div className="space-y-1">
        <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      {/* Fit class skeleton */}
      <div className="space-y-1">
        <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-5 w-24 rounded-full bg-gray-200 dark:bg-gray-700" />
      </div>
      {/* Metrics skeleton */}
      <div className="space-y-1">
        <div className="h-3 w-28 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={cn(
                "flex h-14 flex-col items-center justify-center rounded-md",
                "border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
              )}
            />
          ))}
        </div>
      </div>
      {/* Rationale skeleton */}
      <div className="space-y-1">
        <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-1.5">
          <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-4/6 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </div>
  );
}
