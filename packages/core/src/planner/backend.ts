/**
 * Backend selection — given a device and a quant family, pick the best compute
 * backend actually available, and decide GPU offload + KV-cache type + threads.
 *
 * Encodes the format<->backend compatibility matrix from our research:
 *   gguf  -> cpu / metal / cuda / vulkan / rocm / sycl / webgpu(via wllama is wasm)
 *   mlx   -> metal only (Apple)
 *   awq/gptq/exl2/exl3 -> cuda (fast NVIDIA path), some rocm
 */

import type {
  DeviceProfile,
  QuantFamily,
  BackendKind,
  AcceleratorInfo,
  ModelDescriptor,
  QuantSpec,
} from "../types.ts";

const FAMILY_BACKENDS: Record<QuantFamily, BackendKind[]> = {
  gguf: ["cuda", "metal", "vulkan", "rocm", "sycl", "cpu"],
  mlx: ["metal"],
  awq: ["cuda", "rocm"],
  gptq: ["cuda", "rocm"],
  exl2: ["cuda"],
  exl3: ["cuda"],
  fp16: ["cuda", "metal", "rocm", "cpu"],
  fp32: ["cuda", "metal", "rocm", "cpu"],
};

export interface BackendChoice {
  backend: BackendKind;
  accelerator: AcceleratorInfo;
  rationale: string;
}

/**
 * Choose the best available backend for this quant family on this device.
 * Returns null if the family can't run here (e.g. mlx on Windows).
 */
export function chooseBackend(device: DeviceProfile, family: QuantFamily): BackendChoice | null {
  const allowed = FAMILY_BACKENDS[family];
  // Accelerators are already best-first; intersect with allowed backends.
  for (const acc of device.accelerators) {
    if (!acc.available) continue;
    if (allowed.includes(acc.kind)) {
      return {
        backend: acc.kind,
        accelerator: acc,
        rationale:
          acc.kind === "cpu"
            ? `CPU SIMD fallback (${device.cpu.features.join(", ") || "baseline"})`
            : `${acc.name} via ${acc.kind}${acc.unifiedMemory ? " (unified memory)" : ""}`,
      };
    }
  }
  return null;
}

/**
 * Decide KV-cache quantization. f16 by default; drop to q8_0 / q4_0 when memory
 * is tight. K is more sensitive than V, but our engine sets both together for
 * MVP simplicity; q8_0 is near-lossless.
 */
export function chooseKvCacheType(memoryPressureAtF16: number): "f16" | "q8_0" | "q4_0" {
  if (memoryPressureAtF16 <= 0.7) return "f16";
  if (memoryPressureAtF16 <= 0.9) return "q8_0";
  return "q4_0";
}

/** Threads: use physical cores, leave one for the OS on constrained devices. */
export function chooseThreads(device: DeviceProfile): number {
  const phys = device.cpu.physicalCores;
  if (device.thermallyConstrained) return Math.max(1, Math.floor(phys / 2));
  return Math.max(1, phys - (phys > 4 ? 1 : 0));
}

/**
 * Decide GPU layer offload. With unified memory (Apple) we offload everything
 * if it fits. With discrete VRAM we offload as many layers as VRAM allows.
 */
export function chooseGpuLayers(
  backend: BackendKind,
  accelerator: AcceleratorInfo,
  model: ModelDescriptor,
  weightsBytes: number,
): number | "all" {
  if (backend === "cpu") return 0;
  if (accelerator.unifiedMemory) return "all";
  const vram = accelerator.memoryBytes;
  if (!vram) return "all";
  if (weightsBytes <= vram * 0.9) return "all";
  // Partial offload proportional to VRAM fraction.
  const layers = model.numLayers ?? 32;
  return Math.max(0, Math.floor((vram * 0.85) / (weightsBytes / layers)));
}

/**
 * Should we enable speculative decoding? Worth it when there's memory headroom
 * for a tiny draft model and the target is large enough to benefit.
 */
export function shouldSpeculate(
  model: ModelDescriptor,
  memoryPressure: number,
  device: DeviceProfile,
): boolean {
  if (device.thermallyConstrained) return false; // draft model costs memory/heat
  return model.paramsB >= 7 && memoryPressure < 0.7;
}
