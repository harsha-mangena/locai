/**
 * useServerHealth — polls the LocAI server health endpoint.
 *
 * TanStack Query with 5s refetch interval and 3s timeout.
 * Returns { connected, isLoading }.
 *
 * Requirements: 2.1, 2.2, 2.3
 */

import { useQuery } from "@tanstack/react-query";

export function useServerHealth() {
  const { data, isLoading } = useQuery({
    queryKey: ["server-health"],
    queryFn: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const res = await fetch(
          `${getBaseUrl()}/health`,
          { signal: controller.signal }
        );
        if (!res.ok) return { connected: false };
        const body = await res.json();
        return { connected: body.status === "ok" };
      } catch {
        return { connected: false };
      } finally {
        clearTimeout(timeout);
      }
    },
    refetchInterval: 5000,
    retry: false,
  });

  return {
    connected: data?.connected ?? false,
    isLoading,
  };
}

// Read base URL from localStorage (same logic as api client)
function getBaseUrl(): string {
  try {
    const raw = localStorage.getItem("locai-settings-serverUrl");
    if (raw === null) return "http://localhost:8080";
    return JSON.parse(raw) as string;
  } catch {
    return "http://localhost:8080";
  }
}
