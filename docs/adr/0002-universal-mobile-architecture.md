# ADR-0002: Universal Mobile Architecture — The Real Problem and the Real Solution

Status: **Accepted** · Date: 2026

---

## The Problem We Haven't Solved Yet

The current architecture has a silent fatal assumption buried in `runtime/locai.ts`:

```typescript
// Only plan over models we actually have on disk (MVP: no auto-download).
```

This single comment exposes the gap between what LocAI claims to be and what it
currently is. On a 4 GB RAM phone:

- A 1B parameter model at Q4_K_M = ~700 MB on disk
- A 3B model at Q4_K_M = ~2.0 GB on disk
- The phone has ~1.9 GB usable RAM (jetsam budget, per our own profiler)
- The phone may have 32–128 GB of flash storage

**The question is not "can the model fit in RAM?" — it's "how do we get the model
onto the device, and how do we run it given the RAM ceiling?"**

These are two separate problems that require two separate solutions. The current
codebase solves neither for mobile.

---

## Ground Truth from Research (May 2026)

### What actually runs on a 4 GB phone today

| Approach | Model size | RAM needed | Tok/s | Status |
|---|---|---|---|---|
| llama.cpp CPU (NEON) | 1B Q4_K_M | ~700 MB | 12–20 | ✅ Ships |
| llama.cpp Vulkan (Android GPU) | 1B Q4_K_M | ~700 MB | 15–30 | ✅ Ships (Dec 2025) |
| ExecuTorch + XNNPACK | 1B–3B | ~1–2 GB | 10–25 | ✅ Ships |
| MNN-LLM (Alibaba) | 1B–3B, DRAM+Flash | ~500 MB DRAM | 8–15 | ✅ Ships |
| Gemini Nano (Android AICore) | ~3B built-in | 0 (system) | 20–40 | ✅ Ships (Pixel 9+) |
| Apple Foundation Models (iOS 26) | ~3B built-in | 0 (system) | 20–40 | ✅ Ships |
| ActiveFlow DRAM-Flash swapping | 7B on 4 GB | ~1.5 GB DRAM | 3–8 | Research → near |
| WebGPU (browser, mobile Chrome) | 1B–3B | ~1–2 GB | 5–15 | ✅ Ships |

**Key insight**: A 4 GB phone CAN run a 1B–3B model today. The ceiling is real
but not zero. The problem is: nobody has built the orchestration layer that
automatically picks the right strategy for each device.

### The five execution strategies, ranked by device capability

```
Strategy 1: SYSTEM MODEL (zero cost)
  iOS 26 Foundation Models API → Apple's ~3B on-device model, free
  Android AICore / Gemini Nano → Google's ~3B on-device model, free
  → No download. No RAM cost. Just API calls.
  → Available on: iPhone 15+ (iOS 26), Pixel 9+, Samsung S24+ (Android 15+)

Strategy 2: NATIVE SMALL MODEL (download once, run forever)
  llama.cpp (Vulkan/CPU) on Android, ExecuTorch on iOS
  Models: 1B–3B at Q4_K_M → 700 MB – 2 GB on flash
  RAM: 700 MB – 2 GB (fits in jetsam budget)
  → Available on: any Android 10+ with Vulkan, any iOS 16+

Strategy 3: FLASH-BACKED INFERENCE (bigger model, flash as extended RAM)
  MNN-LLM DRAM-Flash hybrid / ActiveFlow swapping
  Models: 3B–7B stored on flash, hot weights in DRAM
  RAM: 500 MB – 1.5 GB DRAM, rest streamed from flash
  Tok/s: 3–10 (acceptable for many use cases)
  → Available on: Android with fast UFS 3.1+ storage

Strategy 4: BROWSER / PWA (zero install, WebGPU)
  wllama (WASM) or LlamaWeb (WebGPU backend for llama.cpp)
  Models: 1B–3B, cached in browser storage (OPFS)
  RAM: 1–2 GB GPU/WASM
  → Available on: any modern browser (Chrome 113+, Safari 26, Firefox 125+)

Strategy 5: HYBRID EDGE (on-device draft + cloud verify)
  Small model on device for fast/simple queries
  Cloud fallback for complex queries (opt-in, privacy-preserving)
  → Available on: any device with internet
```

### The download problem

A 700 MB model download on mobile is not trivial. The solution is:

1. **Resumable chunked download** — HTTP Range requests, resume on reconnect
2. **Background download** — OS background transfer APIs (iOS BGURLSession,
   Android WorkManager + DownloadManager)
3. **Progressive usability** — start with the system model (Strategy 1) while
   the better model downloads in the background
4. **Delta updates** — only re-download changed tensor blocks when a model
   updates (GGUF's block structure enables this)
5. **Storage-aware selection** — the planner checks `freeDiskBytes` before
   recommending a download

---

## The Revised Architecture

### Core principle: Strategy Cascade

LocAI doesn't pick ONE strategy. It cascades through strategies from best to
acceptable, based on what the device actually supports RIGHT NOW:

```
profileDevice()
    ↓
strategySelector()
    ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 0: System Model Available?                        │
│  iOS 26 FoundationModels API / Android AICore           │
│  → YES: use it immediately, zero cost, zero download    │
│  → NO: continue                                         │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 1: Local GGUF on disk?                            │
│  → YES: plan() → pick best fitting model → run          │
│  → NO: continue                                         │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 2: Enough disk space to download?                 │
│  → YES: show download plan → background download        │
│         → on completion, promote to Tier 1              │
│  → NO: continue                                         │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 3: Browser/PWA available?                         │
│  → YES: route to WebGPU/WASM engine                     │
│         model cached in OPFS (browser storage)          │
│  → NO: continue                                         │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 4: Flash-backed inference viable?                 │
│  (fast storage + model too big for DRAM)                │
│  → YES: DRAM-Flash hybrid mode                          │
│  → NO: continue                                         │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│  TIER 5: Hybrid edge (opt-in)                           │
│  On-device small model + cloud for complex queries      │
│  User explicitly consents to cloud fallback             │
└─────────────────────────────────────────────────────────┘
```

### What this means for the 4 GB phone

**Day 1 (app install, no download yet):**
- iPhone 15+ → Tier 0: Foundation Models API, instant, zero RAM cost
- Pixel 9+ → Tier 0: Gemini Nano via AICore, instant
- Older Android → Tier 3: Browser PWA with wllama, 1B model cached in OPFS
- Any device → Tier 5: Hybrid edge (opt-in)

**After background download completes (~700 MB for 1B Q4_K_M):**
- All devices → Tier 1: Native llama.cpp/ExecuTorch, best performance

**The user never sees "no model available". They always get something.**

---

## Revised Type System

### New types needed

```typescript
// The execution strategy chosen for this device+state combination
export type ExecutionStrategy =
  | "system-model"      // iOS Foundation Models / Android AICore
  | "native-local"      // llama.cpp / ExecuTorch on-device
  | "flash-backed"      // DRAM-Flash hybrid (MNN-LLM style)
  | "browser-wasm"      // wllama / WebGPU in browser
  | "hybrid-edge";      // on-device draft + cloud verify

// Model availability state
export type ModelAvailability =
  | "ready"             // on disk, can run now
  | "downloading"       // in progress, progress 0..1
  | "queued"            // scheduled for background download
  | "not-downloaded"    // not present, disk space available
  | "no-space"          // not present, insufficient disk
  | "system"            // provided by OS, no download needed

// Extended RunPlan with strategy
export interface RunPlan {
  // ... existing fields ...
  strategy: ExecutionStrategy;
  modelAvailability: ModelAvailability;
  downloadPlan?: {
    url: string;
    sizeBytes: number;
    resumable: boolean;
    estimatedMinutes: number;  // at current network speed
  };
}
```

### New engine interfaces needed

```typescript
// System model engine (iOS Foundation Models / Android AICore)
// Zero download, zero RAM cost, OS manages everything
interface SystemModelEngine extends InferenceEngine {
  readonly strategy: "system-model";
  checkAvailability(): Promise<boolean>;
}

// Flash-backed engine (DRAM-Flash hybrid)
// Stores model on flash, streams hot weights to DRAM
interface FlashBackedEngine extends InferenceEngine {
  readonly strategy: "flash-backed";
  readonly flashPath: string;
  readonly dramBudgetBytes: number;
}

// Browser engine (wllama / WebGPU)
// Runs in browser context, model cached in OPFS
interface BrowserEngine extends InferenceEngine {
  readonly strategy: "browser-wasm" | "browser-webgpu";
  readonly opfsPath: string;
}
```

---

## The Model Hub — The Missing Piece

The current `catalog/resolver.ts` only looks at local files. The real resolver
needs to be a **Model Hub** that:

1. **Knows what's available** — catalog of models with download URLs, sizes,
   checksums, and device compatibility
2. **Knows what's on disk** — scans local storage
3. **Knows what's downloading** — tracks in-progress downloads
4. **Recommends what to download** — given the device profile, suggests the
   optimal model to download next
5. **Manages storage** — evicts least-recently-used models when disk is full

```typescript
interface ModelHub {
  // What can run RIGHT NOW (on disk or system model)
  available(device: DeviceProfile): Promise<ModelDescriptor[]>;

  // What should be downloaded for this device
  recommend(device: DeviceProfile): Promise<DownloadRecommendation[]>;

  // Start a background download
  download(model: ModelDescriptor, quant: QuantSpec): Promise<DownloadHandle>;

  // Storage management
  evict(model: ModelDescriptor, quant: QuantSpec): Promise<void>;
  storageUsed(): Promise<number>;
}
```

---

## The Planner Extension

The planner needs a new first pass: **strategy selection** before model
selection. The current planner assumes a model is already loaded. The new
planner:

1. **Detects system model availability** (iOS/Android OS APIs)
2. **Scans local disk** for GGUF files
3. **Checks download queue** for in-progress models
4. **Evaluates flash-backed viability** (storage speed × model size × tok/s
   acceptability threshold)
5. **Falls back to browser** if native isn't viable
6. Returns a `StrategyPlan` that includes BOTH the execution strategy AND the
   model plan

---

## The Demo That Raises Money

The demo that makes investors write checks is this:

**"Watch me run a 3B model on this 4-year-old Android phone with 4 GB RAM."**

1. Open LocAI app on a Pixel 6 (4 GB RAM, no model downloaded)
2. App instantly shows: "Using Gemini Nano (system model) — 0 MB download"
3. User chats. Gets responses at 20 tok/s.
4. Background notification: "Downloading Llama 3.2 3B (2.0 GB) — 4 min on WiFi"
5. Download completes. App silently upgrades: "Now using Llama 3.2 3B (local)"
6. User chats again. Gets responses at 15 tok/s, fully offline, no Google.

**That's the demo. That's the PMF. That's the moat.**

The magic is not the inference — llama.cpp already does that. The magic is the
**orchestration**: knowing which strategy to use, when to upgrade, how to
download safely, and how to explain all of it to the user in plain language.

---

## Implementation Phases

### Phase 1 (MVP demo — 2 weeks)
- [ ] Strategy selector: detect iOS Foundation Models / Android AICore
- [ ] System model engine: thin wrapper over OS APIs
- [ ] Planner extension: strategy cascade (Tier 0 → Tier 1 → Tier 3)
- [ ] Model Hub v1: local scan + download queue + resumable HTTP download
- [ ] Updated `LocAI.create()`: strategy-aware, non-blocking (returns immediately
      with best available strategy, upgrades in background)
- [ ] CLI: show strategy in plan output

### Phase 2 (full mobile — 4 weeks)
- [ ] iOS native engine: ExecuTorch + Foundation Models
- [ ] Android native engine: llama.cpp Vulkan + AICore
- [ ] Background download: iOS BGURLSession, Android DownloadManager
- [ ] Flash-backed engine: MNN-LLM DRAM-Flash hybrid
- [ ] Storage manager: eviction policy, disk pressure handling

### Phase 3 (browser + edge — 4 weeks)
- [ ] Browser engine: wllama (WASM) + LlamaWeb (WebGPU)
- [ ] OPFS model cache management
- [ ] Hybrid edge: on-device draft + cloud verify (opt-in)
- [ ] Progressive model loading: start generating with smaller model while
      larger model downloads

---

## What We Do NOT Do

- We do NOT build our own inference kernel. llama.cpp, ExecuTorch, MNN, and the
  OS system models are the kernels. We orchestrate them.
- We do NOT force users to understand quantization, backends, or strategies.
  The cascade is invisible. The user just opens the app and it works.
- We do NOT compromise on privacy. System model (Tier 0) and native local
  (Tier 1) are fully offline. Hybrid edge (Tier 5) is opt-in with explicit
  consent UI.
- We do NOT download models without user awareness. The download plan is shown
  upfront with size, time estimate, and WiFi-only option.

---

## The Competitive Moat (Revised)

The moat is not just the planner. The moat is the **strategy cascade + model
hub + transparent rationale** working together:

- Ollama: desktop only, no mobile, no strategy cascade
- LM Studio: desktop only, manual model selection
- MLC/WebLLM: browser only, no native path, no system model integration
- ExecuTorch: iOS/Android native but developer-grade, no UX layer
- Gemini Nano / Foundation Models: locked to one vendor's model

**LocAI is the only thing that does all of them, picks the right one
automatically, and explains why.**

That's the product. That's the pitch. That's the raise.
