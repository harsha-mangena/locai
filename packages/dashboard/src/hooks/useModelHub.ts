/**
 * useModelHub — fetches model status and exposes download/delete mutations.
 *
 * TanStack Query with dynamic refetchInterval: 2s when any model is downloading,
 * otherwise disabled.
 * Returns { models, isLoading, download, delete }.
 *
 * Requirements: 15.3, 15.7, 17.2, 17.3
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.ts";
import type { ModelStatus } from "../api/types.ts";

function hasDownloading(models: ModelStatus[] | undefined): boolean {
  if (!models) return false;
  return models.some((m) => m.availability === "downloading");
}

export function useModelHub() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["model-hub"],
    queryFn: () => api.getModels(),
    refetchInterval: (query) =>
      hasDownloading(query.state.data) ? 2000 : false,
  });

  const downloadMutation = useMutation({
    mutationFn: ({ modelId, quantId }: { modelId: string; quantId: string }) =>
      api.downloadModel(modelId, quantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-hub"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ modelId, quantId }: { modelId: string; quantId: string }) =>
      api.deleteModel(modelId, quantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-hub"] });
    },
  });

  return {
    models: (data as ModelStatus[]) ?? [],
    isLoading,
    download: (modelId: string, quantId: string) =>
      downloadMutation.mutate({ modelId, quantId }),
    delete: (modelId: string, quantId: string) =>
      deleteMutation.mutate({ modelId, quantId }),
  };
}
