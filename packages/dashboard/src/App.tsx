/**
 * App — root component composing ThemeProvider, QueryClientProvider, and AppLayout.
 *
 * Wires up:
 * - Dark/light mode toggle with OS preference as default
 * - TanStack Query client
 * - AppLayout with ChatArea, panel components, and SettingsSheet
 * - useChat hook for the full chat flow
 *
 * Requirements: 1.6, 4.6, 4.7, 5.1, 5.2
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout.tsx";
import { ChatArea } from "./components/chat/ChatArea.tsx";
import { WhyPanel } from "./components/panels/WhyPanel.tsx";
import { DevicePanel } from "./components/panels/DevicePanel.tsx";
import { ModelHubPanel } from "./components/panels/ModelHubPanel.tsx";
import { SettingsSheet } from "./components/panels/SettingsSheet.tsx";
import { useChat } from "./hooks/useChat.ts";

// ---------------------------------------------------------------------------
// Theme Provider
// ---------------------------------------------------------------------------

type Theme = "dark" | "light";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(getSystemTheme);

  // Apply theme class on mount and changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for OS preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}

// ---------------------------------------------------------------------------
// Query Client
// ---------------------------------------------------------------------------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  // Theme
  useTheme();

  // Settings sheet state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Chat hook
  const { messages, isGenerating, send, stop, clear: _clear } = useChat();

  // Handlers
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);

  // Panel content — memoized to avoid unnecessary re-renders
  const whyContent = useMemo(() => <WhyPanel />, []);
  const deviceContent = useMemo(() => <DevicePanel />, []);
  const modelsContent = useMemo(() => <ModelHubPanel />, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout
        onOpenSettings={handleOpenSettings}
        whyContent={whyContent}
        deviceContent={deviceContent}
        modelsContent={modelsContent}
      >
        <ChatArea
          messages={messages}
          isGenerating={isGenerating}
          onSend={send}
          onStop={stop}
        />
      </AppLayout>

      <SettingsSheet open={settingsOpen} onClose={handleCloseSettings} />
    </QueryClientProvider>
  );
}
