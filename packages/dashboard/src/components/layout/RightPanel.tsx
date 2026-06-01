/**
 * RightPanel — collapsible 320px panel with tabs (Why / Device / Models).
 *
 * Collapses to 0px with CSS transition. Toggle button sits at the border.
 *
 * Requirements: 1.6, 2.4
 */

import { useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "../../lib/utils.ts";

type TabId = "why" | "device" | "models";

interface RightPanelProps {
  /** Content rendered for the "Why" tab */
  whyContent?: React.ReactNode;
  /** Content rendered for the "Device" tab */
  deviceContent?: React.ReactNode;
  /** Content rendered for the "Models" tab */
  modelsContent?: React.ReactNode;
}

export function RightPanel({ whyContent, deviceContent, modelsContent }: RightPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("why");

  const tabs: { id: TabId; label: string }[] = [
    { id: "why", label: "Why" },
    { id: "device", label: "Device" },
    { id: "models", label: "Models" },
  ];

  return (
    <div className="relative flex">
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed((prev) => !prev)}
        className={cn(
          "absolute -left-3 top-3 z-10 flex h-6 w-6 items-center justify-center",
          "rounded-full border border-gray-200 bg-surface shadow-sm",
          "dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        )}
        aria-label={collapsed ? "Expand panel" : "Collapse panel"}
      >
        {collapsed ? (
          <PanelRightOpen className="h-3.5 w-3.5 text-foreground/70" />
        ) : (
          <PanelRightClose className="h-3.5 w-3.5 text-foreground/70" />
        )}
      </button>

      {/* Panel content */}
      <div
        className={cn(
          "h-full overflow-hidden border-l border-gray-200 bg-surface dark:border-gray-700",
          "transition-[width] duration-300 ease-in-out"
        )}
        style={{ width: collapsed ? 0 : 320 }}
      >
        <div className="flex h-full w-[320px] flex-col">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-foreground/60 hover:text-foreground/80"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === "why" && (whyContent ?? <PlaceholderContent label="Why" />)}
            {activeTab === "device" && (deviceContent ?? <PlaceholderContent label="Device" />)}
            {activeTab === "models" && (modelsContent ?? <PlaceholderContent label="Models" />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderContent({ label }: { label: string }) {
  return (
    <p className="text-sm text-foreground/50">
      {label} panel content will appear here.
    </p>
  );
}
