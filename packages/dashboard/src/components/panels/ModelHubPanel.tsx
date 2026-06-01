/**
 * ModelHubPanel — displays storage usage bar and a list of ModelCards.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.7
 */

import { useModelHub } from "../../hooks/useModelHub.ts";
import { ModelCard } from "./ModelCard.tsx";
import { cn } from "../../lib/utils.ts";

export function ModelHubPanel() {
  const { models, isLoading, download, delete: deleteModel } = useModelHub();

  if (isLoading) {
    return <ModelHubSkeleton />;
  }

  // Calculate storage usage from ready models
  const totalUsedBytes = models
    .filter((m) => m.availability === "ready")
    .reduce((sum, m) => sum + m.sizeBytes, 0);

  const totalAvailableBytes = models.reduce((sum, m) => sum + m.sizeBytes, 0);

  return (
    <div className="space-y-4">
      {/* Storage Usage Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase text-foreground/50">
            Storage Usage
          </h3>
          <span className="text-xs text-foreground/50">
            {formatSize(totalUsedBytes)} used
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              totalAvailableBytes > 0 && totalUsedBytes / totalAvailableBytes > 0.9
                ? "bg-red-500"
                : "bg-blue-500"
            )}
            style={{
              width:
                totalAvailableBytes > 0
                  ? `${Math.min(100, Math.round((totalUsedBytes / totalAvailableBytes) * 100))}%`
                  : "0%",
            }}
          />
        </div>
      </div>

      {/* Model Cards */}
      {models.length === 0 ? (
        <p className="text-sm text-foreground/50">
          No models available. Ensure the LocAI server is running.
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <ModelCard
              key={`${model.model.id}-${model.quant.id}`}
              model={model}
              onDownload={download}
              onDelete={deleteModel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelHubSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Storage bar skeleton */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700" />
      </div>
      {/* Card skeletons */}
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="h-24 rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
        />
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}
