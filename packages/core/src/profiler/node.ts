/**
 * Node device profiler.
 *
 * Reads REAL hardware facts from the host (CPU, RAM, accelerators) and produces
 * a DeviceProfile the planner can reason over. Platform-specific probes are
 * isolated so the browser/RN profilers can swap them out.
 *
 * Design rule: never throw on a missing probe. Degrade to conservative defaults
 * and record lower confidence — a profiler that crashes is worse than one that
 * guesses safely.
 */

import os from "node:os";
import { execSync } from "node:child_process";
import type {
  DeviceProfile,
  AcceleratorInfo,
  Platform,
  CpuArch,
  BackendKind,
} from "../types.ts";

function detectPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "linux";
  }
}

function detectArch(): CpuArch {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      return "unknown";
  }
}

/** Run a shell probe, returning trimmed stdout or "" on any failure. */
function probe(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 4000,
    }).trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// CPU feature detection (drives SIMD kernel selection)
// ---------------------------------------------------------------------------

function detectCpuFeatures(platform: Platform, arch: CpuArch): string[] {
  const features = new Set<string>();
  if (platform === "macos") {
    // Apple Silicon: NEON is universal; check for the dot-product / i8mm
    // extensions that make Q4_0 repacked kernels fast.
    const leaves = probe("sysctl -a 2>/dev/null");
    if (arch === "arm64") {
      features.add("neon");
      if (/hw\.optional\.arm\.FEAT_DotProd:\s*1/.test(leaves)) features.add("dotprod");
      if (/hw\.optional\.arm\.FEAT_I8MM:\s*1/.test(leaves)) features.add("i8mm");
      if (/hw\.optional\.arm\.FEAT_FP16:\s*1/.test(leaves)) features.add("fp16");
      if (/hw\.optional\.arm\.FEAT_BF16:\s*1/.test(leaves)) features.add("bf16");
    } else {
      // Intel Mac
      const f = probe("sysctl -n machdep.cpu.features machdep.cpu.leaf7_features 2>/dev/null").toLowerCase();
      for (const flag of ["avx", "avx2", "avx512f", "fma", "f16c"]) {
        if (f.includes(flag)) features.add(flag);
      }
    }
  } else if (platform === "linux") {
    const cpuinfo = probe("grep -m1 ^flags /proc/cpuinfo || grep -m1 ^Features /proc/cpuinfo");
    const f = cpuinfo.toLowerCase();
    for (const flag of [
      "avx", "avx2", "avx512f", "avx512_vnni", "fma", "f16c", "neon", "asimd", "i8mm", "bf16",
    ]) {
      if (f.includes(flag)) features.add(flag === "asimd" ? "neon" : flag);
    }
  } else if (platform === "windows") {
    if (arch === "x64") {
      features.add("avx"); // conservative baseline; refined by native binding later
    } else {
      features.add("neon");
    }
  }
  return [...features];
}

// ---------------------------------------------------------------------------
// Accelerator detection
// ---------------------------------------------------------------------------

function detectAccelerators(
  platform: Platform,
  arch: CpuArch,
  totalRam: number,
): AcceleratorInfo[] {
  const accels: AcceleratorInfo[] = [];

  if (platform === "macos" && arch === "arm64") {
    // Apple Silicon: Metal GPU with UNIFIED memory. The GPU can address ~system RAM.
    const chip = probe("sysctl -n machdep.cpu.brand_string") || "Apple Silicon";
    accels.push({
      kind: "metal",
      name: `${chip} GPU`,
      memoryBytes: totalRam, // unified
      unifiedMemory: true,
      perfHint: 0.85,
      available: true,
    });
    // CoreML / ANE present but awkward for autoregressive LLM decode — mark
    // available for future delegate use, low perfHint so router won't pick it
    // for general decode yet.
    accels.push({
      kind: "coreml",
      name: "Apple Neural Engine (CoreML)",
      unifiedMemory: true,
      perfHint: 0.4,
      available: true,
    });
  } else {
    // NVIDIA?
    const nvidia = probe(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null",
    );
    if (nvidia) {
      const [name, memMiB] = nvidia.split("\n")[0].split(",").map((s) => s.trim());
      accels.push({
        kind: "cuda",
        name: name || "NVIDIA GPU",
        memoryBytes: Number(memMiB) * 1024 * 1024 || undefined,
        unifiedMemory: false,
        perfHint: 1.0,
        available: true,
      });
    }
    // AMD ROCm?
    const rocm = probe("rocminfo 2>/dev/null | grep -m1 'Marketing Name'");
    if (rocm) {
      accels.push({
        kind: "rocm",
        name: rocm.split(":").pop()?.trim() || "AMD GPU",
        unifiedMemory: false,
        perfHint: 0.8,
        available: true,
      });
    }
    // Vulkan is the portable fallback GPU path — assume present if a GPU exists.
    // (A native binding will confirm; for now we don't fabricate it.)
  }

  // CPU is ALWAYS available — the universal floor.
  accels.push({
    kind: "cpu" as BackendKind,
    name: probe("sysctl -n machdep.cpu.brand_string") || os.cpus()[0]?.model || "CPU",
    memoryBytes: totalRam,
    unifiedMemory: true,
    perfHint: 0.3,
    available: true,
  });

  return accels;
}

// ---------------------------------------------------------------------------
// Usable-RAM heuristic
// ---------------------------------------------------------------------------

/**
 * The OS will not let one process use all physical RAM. We reserve headroom for
 * the OS, other apps, and (critically on mobile) the jetsam/LMK per-app budget.
 *
 * The single most important correction over a naive `totalRam * k` heuristic:
 * on mobile the binding constraint is NOT total RAM, it is the per-app memory
 * limit the OS enforces before it kills you (iOS jetsam, Android low-memory
 * killer). That limit does not scale linearly with RAM — it is a tiered budget.
 * A 6 GB iPhone may terminate an app around ~2.5-3 GB resident even though
 * "6 GB" is on the box. Modeling THAT is the profiler's whole job.
 *
 * Numbers below are conservative priors from field measurements of jetsam
 * limits and Android per-app heap/RSS ceilings; `platform` lets us tighten iOS
 * (hard jetsam) vs Android (softer, but background pressure kills fast).
 */
const GiB_ = 1024 ** 3;

export function estimateUsableRam(
  totalRam: number,
  thermallyConstrained: boolean,
  platform: Platform,
): number {
  if (platform === "ios" || platform === "android") {
    return mobileJetsamBudget(totalRam, platform);
  }

  if (thermallyConstrained) {
    // Fanless non-phone (e.g. some tablets/mini-PCs): aggressive but not as
    // hard-capped as a phone. Reserve ~40%.
    return Math.floor(totalRam * 0.55);
  }

  // Desktop/laptop: reserve ~3GB or 20%, whichever is larger, for the system.
  const reserve = Math.max(3 * GiB_, totalRam * 0.2);
  return Math.max(0, Math.floor(totalRam - reserve));
}

/**
 * Mobile per-app budget under jetsam (iOS) / LMK (Android).
 *
 * This is a TIERED model, not a linear fraction — that is the entire point.
 * The fraction of total RAM an app can safely hold SHRINKS as device RAM grows,
 * because the OS reserves an increasing absolute amount for itself, the
 * foreground compositor, and other apps, and because higher-RAM devices run
 * heavier OS versions. We encode measured-ish breakpoints.
 *
 * Returns the bytes a well-entitled foreground inference app can hold resident
 * with low risk of jetsam during sustained generation (which is itself a memory
 * AND thermal stressor, so we stay conservative).
 */
function mobileJetsamBudget(totalRam: number, platform: Platform): number {
  const gib = totalRam / GiB_;

  // Per-tier safe resident budget in GiB. iOS jetsam is the harder wall; we
  // give iOS slightly less than Android at the same RAM because jetsam
  // termination is abrupt and unrecoverable mid-generation.
  // Tiers chosen around common device RAM sizes (2/3/4/6/8/12/16 GB).
  let budgetGiB: number;
  if (gib <= 2) budgetGiB = 0.9;
  else if (gib <= 3) budgetGiB = 1.38;
  else if (gib <= 4) budgetGiB = 1.9;
  else if (gib <= 6) budgetGiB = 2.6;
  else if (gib <= 8) budgetGiB = 3.2;
  else if (gib <= 12) budgetGiB = 4.3;
  else if (gib <= 16) budgetGiB = 5.2;
  else budgetGiB = gib * 0.3; // very high-RAM tablets

  // Android tends to allow a touch more headroom for a foreground service with
  // largeHeap, but background app pressure can reclaim it fast. Net: ~+10%.
  if (platform === "android") budgetGiB *= 1.1;

  // Never exceed a sane fraction of total (guards the tiny-device edge).
  const cap = gib * 0.7;
  return Math.floor(Math.min(budgetGiB, cap) * GiB_);
}

function detectThermalConstraint(platform: Platform): boolean {
  if (platform === "ios" || platform === "android") return true;
  if (platform === "macos") {
    // MacBook (laptop) vs Mac desktop. Laptops are mildly constrained but have
    // fans; we treat them as NOT thermally constrained for sizing (they sustain).
    return false;
  }
  return false;
}

function detectMemoryBandwidth(brand: string): number | undefined {
  // Coarse priors for common Apple Silicon; refined later by benchmark.
  const b = brand.toLowerCase();
  if (b.includes("m1 pro")) return 200;
  if (b.includes("m1 max")) return 400;
  if (b.includes("m1 ultra")) return 800;
  if (b.includes("m1")) return 68;
  if (b.includes("m2 pro")) return 200;
  if (b.includes("m2 max")) return 400;
  if (b.includes("m2")) return 100;
  if (b.includes("m3 max")) return 400;
  if (b.includes("m3")) return 100;
  if (b.includes("m4 max")) return 546;
  if (b.includes("m4")) return 120;
  return undefined;
}

function detectFreeDisk(): number | undefined {
  const out = probe("df -k / 2>/dev/null | tail -1");
  if (!out) return undefined;
  const cols = out.split(/\s+/);
  // df -k: 1024-blocks available is typically column 4 (index 3)
  const availBlocks = Number(cols[3]);
  return Number.isFinite(availBlocks) ? availBlocks * 1024 : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function profileDevice(): DeviceProfile {
  const platform = detectPlatform();
  const arch = detectArch();
  const totalRam = os.totalmem();
  const thermallyConstrained = detectThermalConstraint(platform);
  const brand =
    probe("sysctl -n machdep.cpu.brand_string") || os.cpus()[0]?.model || "Unknown CPU";

  const logicalCores = os.cpus().length;
  // Physical cores: on Apple Silicon, os.cpus() reports P+E logical = physical.
  let physicalCores = logicalCores;
  if (platform === "macos") {
    const phys = Number(probe("sysctl -n hw.physicalcpu"));
    if (Number.isFinite(phys) && phys > 0) physicalCores = phys;
  } else if (platform === "linux") {
    const phys = Number(probe("nproc --all"));
    if (Number.isFinite(phys) && phys > 0) physicalCores = phys;
  }

  return {
    platform,
    arch,
    totalRamBytes: totalRam,
    usableRamBytes: estimateUsableRam(totalRam, thermallyConstrained, platform),
    cpu: {
      brand,
      physicalCores,
      logicalCores,
      features: detectCpuFeatures(platform, arch),
    },
    accelerators: detectAccelerators(platform, arch, totalRam),
    memoryBandwidthGBs: detectMemoryBandwidth(brand),
    thermallyConstrained,
    freeDiskBytes: detectFreeDisk(),
    capturedAt: new Date().toISOString(),
    source: "node",
  };
}
