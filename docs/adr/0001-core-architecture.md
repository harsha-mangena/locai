# ADR-0001: Core architecture & language for the orchestration layer

Status: **Accepted** · Date: 2026

## Context

We are building LocAI: a universal, open-source, zero-config local LLM runtime
targeting phones, tablets, laptops, desktops, browsers, and edge devices. The
first build decision determines everything downstream: **what language and shape
the irreducible core (device profiler + auto-quant planner + engine
abstraction + backend router) takes.**

Ground-truth from research (late 2025 / 2026), verified before deciding:

- `ggml` exposes a stable-enough **backend registry** (`ggml_backend_reg_*`,
  `ggml_backend_dev_*`) and **loadable backends** (`GGML_BACKEND_DL`) — this is
  the proven cross-platform inference spine. Public C API is *not* ABI-stable →
  pin a commit.
- **imatrix** calibration + **Unsloth Dynamic (UD)** quants are current SOTA for
  sub-4-bit GGUF.
- **WebGPU** now ships on all three browser engines (Safari 26 landed it in
  2025) → the browser is a real deployment surface (~7–8B 4-bit ceiling).
- **ExecuTorch 1.0** + **Apple Foundation Models API** (iOS 26) matured the
  mobile/NPU paths.

## Decision

### D1. Do not reinvent the inference kernel.
Our defensible value is the **orchestration layer**, not a new GEMM. We ride
llama.cpp/ggml (portable spine), MLX (Apple), and WebGPU (browser) through a
single **engine-abstraction interface**. Differentiate on UX + reach + auto-
targeting.

### D2. Build the orchestration core in TypeScript, run on Node 22 with native
`--experimental-strip-types` (zero build step).
Tree-of-Thoughts evaluated three branches:
- **Rust core** — best long-term (safety, WASM, Tauri) but not installed; slower
  to first working artifact.
- **C++ on ggml** — closest to metal but slowest to iterate; weak for the
  orchestration/UX layer.
- **TypeScript core** ✅ — the moat (profiler, planner, router, server) is pure
  logic + system introspection. TS runs the *same logic* in Node (desktop),
  browser, and React Native (mobile), which is exactly our cross-device thesis.
  Heavy inference stays in the native engines we shell out to / bind.

Chosen: **TypeScript core**, with native engine bindings added incrementally
behind the `InferenceEngine` interface.

### D3. Types are the contract.
`DeviceProfile`, `QuantSpec`, `ModelDescriptor`, `RunPlan` are dependency-free
and platform-agnostic so they run identically everywhere. Every layer depends on
these, never on a concrete engine.

### D4. GGUF-native.
Day-one access to the entire existing model universe; no proprietary format.
safetensors → GGUF conversion as an ingest path.

### D5. The planner is deterministic, pure, and tested.
Memory math (weights + GQA-aware KV cache), bandwidth-bound speed model, and a
bpw→quality curve (imatrix-aware) are atomic, independently-testable functions.
Goal-weighted scoring with an explicit **anti-"opaque-quant"** correction:
penalize sub-4-bit quant when memory headroom makes a higher-bit variant
affordable. Confidence + human-readable rationale on every plan (trust).

## Consequences

- ✅ A *running* product on day one (profiler + planner work on real hardware).
- ✅ One codebase path to desktop/browser/mobile.
- ✅ Engines are swappable; no lock-in to one inference backend.
- ⚠️ TypeScript is not the final inference path — native bindings (N-API / WASM /
  RN native modules) are required for production speed. Acceptable: the moat is
  the orchestration logic, which TS serves perfectly.
- ⚠️ ggml C API churn → we pin a commit and isolate the binding behind the
  engine interface.

## Re-verify before depending on
EXL3/QTIP stable status; exact `mlx-lm` quant flags (DWQ/AWQ); ExecuTorch NPU
delegate GA vs experimental; per-device WebGPU `maxStorageBufferBindingSize`.
