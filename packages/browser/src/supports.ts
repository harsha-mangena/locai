/**
 * Capability detection helpers for browser inference engines.
 */

/** Check if WebGPU is available in the current environment. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Probe GPU adapter limits for memory assessment. */
export async function probeGPULimits(): Promise<{
  available: boolean;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
} | null> {
  if (!isWebGPUAvailable()) return null;

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;

  return {
    available: true,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  };
}

/** Check if Origin Private File System (OPFS) is available. */
export function isOPFSAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    "getDirectory" in navigator.storage
  );
}
