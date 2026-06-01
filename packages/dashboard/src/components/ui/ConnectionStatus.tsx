/**
 * ConnectionStatus — top bar showing server connection state.
 *
 * Displays a green/red dot, the server URL, and a reconnect prompt
 * when disconnected.
 *
 * Requirements: 2.2, 2.3
 */

import { useServerHealth } from "../../hooks/useServerHealth.ts";
import { useSettings } from "../../hooks/useSettings.ts";
import { cn } from "../../lib/utils.ts";

export function ConnectionStatus() {
  const { connected, isLoading } = useServerHealth();
  const { settings } = useSettings();

  return (
    <div
      className={cn(
        "col-span-3 flex h-10 items-center gap-2 border-b border-gray-200 px-4",
        "dark:border-gray-700 bg-surface"
      )}
    >
      {/* Status dot */}
      <span
        className={cn(
          "inline-block h-2.5 w-2.5 rounded-full",
          isLoading && "bg-gray-400 animate-pulse",
          !isLoading && connected && "bg-green-500",
          !isLoading && !connected && "bg-red-500"
        )}
        aria-label={connected ? "Connected" : "Disconnected"}
      />

      {/* Server URL */}
      <span className="text-sm text-foreground/70 truncate">
        {settings.serverUrl}
      </span>

      {/* Status label */}
      <span className="text-xs text-foreground/50">
        {isLoading ? "Checking…" : connected ? "Connected" : "Disconnected"}
      </span>

      {/* Reconnect prompt when disconnected */}
      {!isLoading && !connected && (
        <span className="ml-auto text-xs text-red-500">
          Server unreachable — check that LocAI is running
        </span>
      )}
    </div>
  );
}
