/**
 * SettingsSheet — slide-over panel for inference settings.
 *
 * Controls: goal selector, max tokens, temperature slider, context length,
 * server URL. All changes persisted to localStorage immediately via useSettings().
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */

import { X, Zap, Scale, Sparkles } from "lucide-react";
import { useSettings, type Settings } from "../../hooks/useSettings.ts";
import { cn } from "../../lib/utils.ts";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const { settings, update } = useSettings();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet */}
      <div className="relative z-10 flex h-full w-80 flex-col overflow-y-auto border-l border-gray-200 bg-surface shadow-xl dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-foreground/60 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6 p-4">
          {/* Goal Selector */}
          <GoalSelector
            value={settings.goal}
            onChange={(goal) => update({ goal })}
          />

          {/* Max Tokens */}
          <NumberField
            label="Max Tokens"
            hint="0 = unlimited"
            value={settings.maxTokens}
            min={0}
            onChange={(maxTokens) => update({ maxTokens })}
          />

          {/* Temperature Slider */}
          <TemperatureSlider
            value={settings.temperature}
            onChange={(temperature) => update({ temperature })}
          />

          {/* Context Length */}
          <NumberField
            label="Context Length"
            hint="Tokens of context to send"
            value={settings.contextLength}
            min={256}
            onChange={(contextLength) => update({ contextLength })}
          />

          {/* Server URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">
              Server URL
            </label>
            <input
              type="text"
              value={settings.serverUrl}
              onChange={(e) => update({ serverUrl: e.target.value })}
              className={cn(
                "w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm",
                "text-foreground placeholder:text-foreground/40",
                "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
                "dark:border-gray-700"
              )}
              placeholder="http://localhost:8080"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function GoalSelector({
  value,
  onChange,
}: {
  value: Settings["goal"];
  onChange: (goal: Settings["goal"]) => void;
}) {
  const goals: { id: Settings["goal"]; label: string; icon: React.ReactNode }[] = [
    { id: "quality", label: "Quality", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "balanced", label: "Balanced", icon: <Scale className="h-3.5 w-3.5" /> },
    { id: "speed", label: "Speed", icon: <Zap className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground/70">Goal</label>
      <div className="grid grid-cols-3 gap-1">
        {goals.map((goal) => (
          <button
            key={goal.id}
            onClick={() => onChange(goal.id)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors",
              value === goal.id
                ? "border border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                : "border border-gray-200 text-foreground/60 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            )}
          >
            {goal.icon}
            {goal.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground/70">{label}</label>
        {hint && <span className="text-xs text-foreground/40">{hint}</span>}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          if (!isNaN(parsed)) {
            onChange(parsed);
          }
        }}
        className={cn(
          "w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm",
          "text-foreground placeholder:text-foreground/40",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
          "dark:border-gray-700"
        )}
      />
    </div>
  );
}

function TemperatureSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground/70">
          Temperature
        </label>
        <span className="text-xs font-mono text-foreground/60">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-500"
      />
      <div className="flex justify-between text-xs text-foreground/40">
        <span>0</span>
        <span>1</span>
        <span>2</span>
      </div>
    </div>
  );
}
