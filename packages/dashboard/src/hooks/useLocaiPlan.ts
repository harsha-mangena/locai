/**
 * useLocaiPlan — fetches the current auto-plan rationale from the server.
 *
 * TanStack Query with 30s staleTime.
 * Returns { plan, isLoading, error }.
 *
 * Requirements: 3.1, 3.5
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.ts";
import type { PlanResponse } from "../api/types.ts";

export function useLocaiPlan() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["locai-plan"],
    queryFn: () => api.getPlan(),
    staleTime: 30_000,
  });

  return {
    plan: (data as PlanResponse) ?? null,
    isLoading,
    error: error as Error | null,
  };
}
