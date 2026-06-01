<div align="center">

# LocAI

**The universal, open-source, zero-config local AI runtime.**

Run powerful LLMs fully locally on any device — phone, tablet, laptop, desktop, browser, edge — with zero cloud dependency. Open the app or CLI; it detects your hardware, picks the right model and strategy automatically, and runs it at the best speed your silicon allows.

`Apache-2.0` · fully offline · fully auditable

</div>

---

## Why LocAI

The local-AI space has polished-but-desktop-only tools (Ollama, LM Studio), portable-but-developer-grade engines (llama.cpp, MLC), and powerful-but-vendor-locked runtimes (MLX, Qualcomm, picoLLM). **No one combines all four winning properties at once:**

- ✅ **Consumer-grade UX** — no quant/format/hardware/strategy decisions pushed onto the user
- ✅ **Genuinely open-source** — Apache-2.0, GGUF-native, no proprietary lock-in format
- ✅ **True cross-device reach** — phone ↔ laptop ↔ desktop ↔ browser ↔ edge, one codebase
- ✅ **Hardware-adaptive auto-targeting** — best model + quant + backend + strategy chosen per device

That intersection is the wedge. **We don't reinvent the inference kernel** — we ride the best open engines (llama.cpp/ggml, MLX, WebGPU, ExecuTorch) and win on the orchestration layer everyone else treats as an afterthought.

---

## The moat: strategy cascade + auto-planning

The fundamental insight competitors miss: **"can this model run?" and "is this model here?" are two separate problems.** LocAI solves both.

### The strategy cascade

Given your device, LocAI cascades through execution strategies from best to acceptable — and always finds one that works **right now**:

```
Tier 0: SYSTEM MODEL    iOS Foundation Models (iOS 26) / Android AICore (Gemini Nano)
                        Zero download. Zero RAM cost. Instant. OS manages everything.

Tier 1: NATIVE LOCAL    GGUF on disk → llama.cpp (Metal/Vulkan/CUDA/CPU)
                        Best performance. Fully offline. Requires a downloaded model.

Tier 2: DOWNLOAD        Best model not on disk → schedule background download.
                        Use Tier 0 or Tier 3 while it downloads. Auto-upgrade on complete.

Tier 3: FLASH-BACKED    Model on flash storage, hot weights streamed to DRAM.
                        Enables 3B models on 2 GB DRAM. 3–8 tok/s. MNN-LLM style.

Tier 4: BROWSER         WebGPU (LlamaWeb) or WASM (wllama). Model cached in OPFS.
                        Zero install. Works in any modern browser.

Tier 5: HYBRID EDGE     On-device small model + cloud for complex queries. Opt-in only.
```

**The user never sees "no model available". They always get something.**

### The demo that raises money

**"Watch me run a 3B model on this 4-year-old Android phone with 4 GB RAM."**

1. Open LocAI on a Pixel 6 (4 GB RAM, no model downloaded)
2. App instantly shows: *"Using Gemini Nano (system model) — 0 MB download"*
3. User chats. Gets responses at 20 tok/s.
4. Background notification: *"Downloading Llama 3.2 3B (2.0 GB) — 4 min on WiFi"*
5. Download completes. App silently upgrades: *"Now using Llama 3.2 3B (local)"*
6. User chats again. 15 tok/s, fully offline, no Google.

The magic is not the inference — llama.cpp already does that. The magic is the **orchestration**: knowing which strategy to use, when to upgrade, how to download safely, and how to explain all of it in plain language.

### The auto-planner (within Tier 1)

Once a model is local, the planner enumerates every `(model × quant)` candidate, prices out memory (weights + KV cache, GQA-aware), predicts decode speed (bandwidth-bound model with decode-cliff detection), scores quality × fit × speed against your goal, and returns the optimal plan:

```
★ BEST: Llama 3.2 3B Instruct · Q4_K_M · metal
  Using Llama 3.2 3B Instruct (3.2B) at Q4_K_M (4.9 bpw, imatrix).
  Apple M1 Pro GPU via metal (unified memory).
  Fits in 5.8 GiB of 12.8 GiB usable RAM (45% pressure).
  KV cache quantized to q4_0 to fit the chosen context.
  Model uses grouped-query attention → compact KV cache.
  Estimated ~66 tokens/sec decode.
  Quality retention ~98% vs full precision.
```

It correctly prefers a *bigger-but-quantized* model over a *small-but-precise* one when that wins — but **won't waste your RAM on an aggressive 2-bit quant when a 4-bit one fits easily.**

---

## Local agent CLI

LocAI includes an alpha **Claude Code-like local CLI** called `lai`.

It is designed for the local-first developer workflow:

- profile the machine and run the selected local model through the LocAI server
- stream agent progress through SSE
- let the model call local tools such as `file_read`, `grep_search`, `git_status`, `git_diff`, and `web_fetch`
- pause for per-action approval before destructive tools (`file_write`, `shell_exec`)
- support `always approve` for repeated trusted actions during a session
- work against the same OpenAI-compatible local runtime used by the dashboard

The CLI works locally today and covers the core Claude Code-like loop: prompt, inspect files, call tools, ask before dangerous actions, stream progress, and keep a local transcript. It is still early: multi-file patch review and the dashboard agent tab are next.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  UX LAYER   Desktop (Tauri) · Mobile (native) · Web (PWA/WebGPU) │
├──────────────────────────────────────────────────────────────────┤
│  STRATEGY CASCADE   Tier 0 → Tier 1 → Tier 2 → … → Tier 5       │ ← the real moat
│  Device Profiler → Strategy Selector → Model Hub                 │
│  Auto-Quant Planner · OpenAI-compat Server · Local Agent Tools   │
├──────────────────────────────────────────────────────────────────┤
│  ENGINE ABSTRACTION   load / generate(stream) / unload           │
│  System Model Engine · LlamaCpp Engine · Flash Engine            │
│  Browser WASM Engine · Browser WebGPU Engine                     │
├──────────────────────────────────────────────────────────────────┤
│  BACKEND ROUTER   cpu(NEON/AVX) · metal · cuda · vulkan ·        │
│                   webgpu · coreml/qnn/openvino NPU               │
├──────────────────────────────────────────────────────────────────┤
│  FORMAT   GGUF (native) ← safetensors converter                  │
│  MODEL HUB   resumable download · storage mgmt · delta updates   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quickstart

Requires **Node 22+** (native TypeScript execution, zero build step for the core).

```bash
# Profile this device
npm run profile

# Show the full strategy cascade for this device
npm run plan                       # balanced
npm run plan -- --goal quality     # maximize accuracy
npm run plan -- --goal speed       # maximize tok/s
npm run plan -- --goal balanced --context 16384

# Run the test suite (planner physics + strategy cascade + decision guards)
npm test --workspaces
```

### Run the local server

The server exposes `/v1/chat/completions` plus LocAI-specific planning, model hub, and agent endpoints.

```bash
# Requires a GGUF model in ./models and a built llama-server binary.
npm run serve
```

### Use the Claude Code-like local CLI

In another terminal:

```bash
# One-shot local task, read-only tools by default
npm run start --workspace=packages/cli -- "inspect this repo and summarize the architecture"

# Interactive REPL
npm run start --workspace=packages/cli

# Trusted local run with file_write and shell_exec enabled
npm run start --workspace=packages/cli -- --allow-dangerous "update README with the new CLI workflow"

# Read-only mode: never write files or run shell commands
npm run start --workspace=packages/cli -- --read-only "review this repo"
```

By default, `lai` uses interactive approvals for destructive actions. Use `--allow-dangerous` only for trusted local runs.

---

## Status

| Component | State |
|---|---|
| Device profiler (Node) | ✅ reads real CPU/RAM/SIMD/accelerators |
| Auto-quant planner | ✅ memory + speed + quality model, goal-weighted, tested |
| Exact model/quant resolver | ✅ local availability must match model + quant |
| Strategy cascade (Tier 0–5) | ✅ selector + tests |
| Engine-abstraction interface + router | ✅ contract defined |
| Seed model catalog (GGUF) | ✅ 1.5B → 14B, real arch dims |
| Model Hub (download + storage mgmt) | ✅ resumable HTTP, redirect handling, LRU eviction |
| Flash-backed viability model | ✅ DRAM-Flash physics, tested |
| llama.cpp engine binding | ✅ process-backed (llama-server) |
| OpenAI-compatible server | ✅ streaming + non-streaming |
| Local tool-call bridge | ✅ structured local protocol + parser |
| Agent endpoint | ✅ `/locai/agent/run` SSE + `/locai/agent/approve` + `/locai/agent/stop` |
| Local coding tools | ✅ read/search/git/web tools; write/shell gated |
| Agent SDK | ✅ SSE consumer + typed events |
| `lai` local CLI | ✅ Claude Code-like REPL + one-shot tasks + sessions |
| Interactive approval queue | ✅ terminal approval flow |
| Dashboard chat | ✅ streaming UI + planning/device/model panels |
| Dashboard agent tab | 🔜 |
| System model engine (iOS Foundation Models) | 🔜 platform bridge needed |
| System model engine (Android AICore) | 🔜 platform bridge needed |
| Browser WASM engine (wllama) | 🔜 |
| Browser WebGPU engine (LlamaWeb) | 🔜 |
| Mobile (iOS/Android) native app | 🔜 |
| Background download (iOS BGURLSession) | 🔜 |
| Background download (Android DownloadManager) | 🔜 |

---

## Design principles

1. **Don't reinvent the kernel.** Orchestrate the best open engines; differentiate on UX + reach.
2. **Zero decisions for the user.** Every quant/backend/strategy choice is auto-derived and explained.
3. **Always runnable.** The strategy cascade guarantees something works right now, even before any download.
4. **GGUF-native.** Day-one access to the entire existing model universe; no proprietary format.
5. **Degrade safely, never crash.** A profiler that guesses conservatively beats one that throws.
6. **Memory & thermal first on mobile.** Size to the per-app jetsam budget, not the spec sheet.
7. **Transparent rationale.** Every decision — strategy, model, quant, backend — is explained in plain language.

---

## License

Apache-2.0. Core stays open forever.
