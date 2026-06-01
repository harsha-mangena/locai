/**
 * useDeviceProfile — fetches the device hardware profile from the server.
 *
 * TanStack Query with staleTime: Infinity (device doesn't change at runtime).
 * Returns { device, isLoading, error }.
 *
 * Requirements: 15.3
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.ts";
import type { DeviceProfile } from "../api/types.ts";

export function useDeviceProfile() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["device-profile"],
    queryFn: () => api.getDevice(),
    staleTime: Infinity,
  });

  return {
    device: (data as DeviceProfile) ?? null,
    isLoading,
    error: error as Error | null,
  };
}
