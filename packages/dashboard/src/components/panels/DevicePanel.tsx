/**
 * DevicePanel — displays the device hardware profile.
 *
 * Shows platform, CPU, RAM, bandwidth, thermal state, and accelerators.
 * Skeleton while loading; error message on failure.
 *
 * Requirements: 16.2, 16.3, 16.4, 16.5
 */

import { Cpu, HardDrive, Thermometer, Zap } from "lucide-react";
import { useDeviceProfile } from "../../hooks/useDeviceProfile.ts";
import { cn } from "../../lib/utils.ts";

export function DevicePanel() {
  const { device, isLoading, error } = useDeviceProfile();

  if (isLoading) {
    return <DevicePanelSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
        <p className="text-sm text-red-700 dark:text-red-400">
          Failed to load device profile: {error.message}
        </p>
      </div>
    );
  }

  if (!device) {
    return (
      <p className="text-sm text-foreground/50">
        No device profile available.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Platform */}
      <InfoRow label="Platform" value={`${device.platform} (${device.arch})`} />

      {/* CPU */}
      <InfoRow
        label="CPU"
        value={`${device.cpu.brand} — ${device.cpu.physicalCores}P/${device.cpu.logicalCores}L cores`}
        icon={<Cpu className="h-3.5 w-3.5 text-foreground/50" />}
      />

      {/* RAM */}
      <InfoRow
        label="RAM"
        value={`${formatBytes(device.totalRamBytes)} total / ${formatBytes(device.usableRamBytes)} usable`}
        icon={<HardDrive className="h-3.5 w-3.5 text-foreground/50" />}
      />

      {/* Bandwidth */}
      {device.memoryBandwidthGBs != null && (
        <InfoRow
          label="Bandwidth"
          value={`${device.memoryBandwidthGBs.toFixed(1)} GB/s`}
          icon={<Zap className="h-3.5 w-3.5 text-foreground/50" />}
        />
      )}

      {/* Thermal Badge */}
      {device.thermallyConstrained && (
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-orange-500" />
          <span className="inline-flex items-center rounded-full bg-orange-500/20 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
            Thermally Constrained
          </span>
        </div>
      )}

      {/* Accelerators */}
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase text-foreground/50">
          Accelerators
        </h3>
        {device.accelerators.length === 0 ? (
          <p className="text-sm text-foreground/50">None detected</p>
        ) : (
          <ul className="space-y-1.5">
            {device.accelerators.map((acc, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {acc.name}
                  </span>
                  <span className="text-xs text-foreground/50">
                    {acc.kind}
                    {acc.memoryBytes != null && ` — ${formatBytes(acc.memoryBytes)}`}
                  </span>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    acc.available
                      ? "bg-green-500/20 text-green-700 dark:text-green-400"
                      : "bg-gray-500/20 text-gray-600 dark:text-gray-400"
                  )}
                >
                  {acc.available ? "Available" : "Unavailable"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-xs font-medium uppercase text-foreground/50">
        {label}
      </h3>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-sm text-foreground">{value}</span>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function DevicePanelSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="space-y-1">
          <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      ))}
      <div className="space-y-1">
        <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-12 w-full rounded-md bg-gray-200 dark:bg-gray-700" />
        <div className="h-12 w-full rounded-md bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}
