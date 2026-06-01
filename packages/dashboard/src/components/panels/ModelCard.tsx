/**
 * ModelCard — displays a single model variant with name, params, size,
 * availability badge, download progress, and action button.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5
 */

import { Download, Trash2, Check } from "lucide-react";
import type { ModelStatus, ModelAvailability } from "../../api/types.ts";
import { cn } from "../../lib/utils.ts";

interface ModelCardProps {
  model: ModelStatus;
  onDownload: (modelId: string, quantId: string) => void;
  onDelete: (modelId: string, quantId: string) => void;
}

export function ModelCard({ model, onDownload, onDelete }: ModelCardProps) {
  const { availability, downloadProgress } = model;

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      {/* Model info */}
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <span className="text-sm font-medium text-foreground">
            {model.model.displayName}
          </span>
          <div className="flex items-center gap-2 text-xs text-foreground/60">
            <span>{model.model.paramsB}B params</span>
            <span>•</span>
            <span>{model.quant.id}</span>
            <span>•</span>
            <span>{formatSize(model.sizeBytes)}</span>
          </div>
        </div>
        <AvailabilityBadge availability={availability} />
      </div>

      {/* Download progress bar */}
      {availability === "downloading" && downloadProgress != null && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${Math.round(downloadProgress * 100)}%` }}
            />
          </div>
          <span className="text-xs text-foreground/50">
            {Math.round(downloadProgress * 100)}% downloaded
          </span>
        </div>
      )}

      {/* Action button */}
      <div className="mt-2">
        <ActionButton
          availability={availability}
          onDownload={() => onDownload(model.model.id, model.quant.id)}
          onDelete={() => onDelete(model.model.id, model.quant.id)}
        />
      </div>
    </div>
  );
}

function AvailabilityBadge({ availability }: { availability: ModelAvailability }) {
  const styles: Record<ModelAvailability, string> = {
    ready: "bg-green-500/20 text-green-700 dark:text-green-400",
    downloading: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
    queued: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
    available: "bg-gray-500/20 text-gray-600 dark:text-gray-400",
    "no-space": "bg-red-500/20 text-red-700 dark:text-red-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        styles[availability]
      )}
    >
      {availability === "no-space" ? "No Space" : availability}
    </span>
  );
}

function ActionButton({
  availability,
  onDownload,
  onDelete,
}: {
  availability: ModelAvailability;
  onDownload: () => void;
  onDelete: () => void;
}) {
  if (availability === "ready") {
    return (
      <button
        onClick={onDelete}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
          "border border-red-200 text-red-700 hover:bg-red-50",
          "dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20",
          "transition-colors"
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    );
  }

  if (availability === "available") {
    return (
      <button
        onClick={onDownload}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
          "border border-blue-200 text-blue-700 hover:bg-blue-50",
          "dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20",
          "transition-colors"
        )}
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </button>
    );
  }

  if (availability === "downloading" || availability === "queued") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-foreground/50">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        {availability === "downloading" ? "Downloading…" : "Queued"}
      </span>
    );
  }

  // no-space
  return (
    <span className="flex items-center gap-1.5 text-xs text-foreground/50">
      <Check className="h-3.5 w-3.5 text-gray-400" />
      Insufficient storage
    </span>
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
