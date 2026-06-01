/**
 * AppLayout — CSS grid layout for the dashboard.
 *
 * Grid: 240px sidebar | 1fr chat | 320px right panel
 * Rows: 40px connection status bar | 1fr content
 * ConnectionStatus spans all 3 columns in row 1.
 *
 * Requirements: 1.6, 2.2, 2.3, 2.4
 */

import { ConnectionStatus } from "../ui/ConnectionStatus.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { RightPanel } from "./RightPanel.tsx";

interface AppLayoutProps {
  /** Chat area content rendered in the center column */
  children: React.ReactNode;
  /** Callback when the settings button is clicked */
  onOpenSettings?: () => void;
  /** Content for the Why tab in the right panel */
  whyContent?: React.ReactNode;
  /** Content for the Device tab in the right panel */
  deviceContent?: React.ReactNode;
  /** Content for the Models tab in the right panel */
  modelsContent?: React.ReactNode;
}

export function AppLayout({
  children,
  onOpenSettings,
  whyContent,
  deviceContent,
  modelsContent,
}: AppLayoutProps) {
  return (
    <div
      className="grid h-screen w-screen overflow-hidden bg-surface text-foreground"
      style={{
        gridTemplateColumns: "240px 1fr auto",
        gridTemplateRows: "40px 1fr",
      }}
    >
      {/* Row 1: ConnectionStatus spanning all columns */}
      <ConnectionStatus />

      {/* Row 2, Col 1: Sidebar */}
      <Sidebar onOpenSettings={onOpenSettings} />

      {/* Row 2, Col 2: Chat area (children) */}
      <main className="flex flex-col overflow-hidden">
        {children}
      </main>

      {/* Row 2, Col 3: Right panel */}
      <RightPanel
        whyContent={whyContent}
        deviceContent={deviceContent}
        modelsContent={modelsContent}
      />
    </div>
  );
}
