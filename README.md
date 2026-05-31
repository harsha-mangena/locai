<div align="center">

# LocAI

**The universal, open-source, zero-config local AI runtime.**

Run powerful LLMs fully locally on any device — phone, tablet, laptop, desktop, browser, edge — with zero cloud dependency. Download one app; it detects your hardware, picks the right model and quantization automatically, and runs it at the best speed your silicon allows.

`Apache-2.0` · fully offline · fully auditable

</div>

---

## Why LocAI

The local-AI space has polished-but-desktop-only tools (Ollama, LM Studio), portable-but-developer-grade engines (llama.cpp, MLC), and powerful-but-vendor-locked runtimes (MLX, Qualcomm, picoLLM). **No one combines all four winning properties at once:**

- ✅ **Consumer-grade UX** — no quant/format/hardware decisions pushed onto the user
- ✅ **Genuinely open-source** — Apache-2.0, GGUF-native, no proprietary lock-in format
- ✅ **True cross-device reach** — phone ↔ laptop ↔ desktop ↔ browser ↔ edge, one codebase
- ✅ **Hardware-adaptive auto-targeting** — best model + quant + backend chosen per device

That intersection is the wedge. **We don't reinvent the inference kernel** — we ride the best open engines (llama.cpp/ggml, MLX, WebGPU) and win on the orchestration layer everyone else treats as an afterthought.

## The moat: auto-planning

Given your device, LocAI enumerates every `(model × quant)` candidate, prices out memory (weights + KV cache, GQA-aware), predicts decode speed (bandwidth-bound model), scores quality × fit × speed against your goal, and returns the optimal plan — with a transparent rationale.

```
★ BEST: Llama 3.2 3B Instruct · IQ4_XS · metal
  Selected Llama 3.2 3B Instruct (3.2B) at IQ4_XS (4.3 bpw, imatrix).
  Apple M1 Pro GPU via metal (unified memory).
  Fits in 2.9 GiB of 12.8 GiB usable RAM (23% pressure).
  Model uses grouped-query attention → compact KV cache.
  Estimated ~76 tokens/sec decode.  Quality retention ~97%.
```

It correctly prefers a *bigger-but-quantized* model over a *small-but-precise* one when that wins — but **won't waste your RAM on an aggressive 2-bit quant when a 4-bit one fits easily.** That judgment is the difference between a product and a benchmark.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UX LAYER   Desktop (Tauri) · Mobile (native) · Web (WebGPU)  │
├──────────────────────────────────────────────────────────────┤
│  ORCHESTRATION   Device Profiler → Auto-Quant Planner →       │ ← the moat
│                  Model Hub · OpenAI-compat Server · RAG        │
├──────────────────────────────────────────────────────────────┤
│  ENGINE ABSTRACTION   load / generate(stream) / unload        │
│                       KV-cache quant · spec-decode · GQA-aware │
├──────────────────────────────────────────────────────────────┤
│  BACKEND ROUTER   cpu(NEON/AVX) · metal · cuda · vulkan ·      │
│                   webgpu · [coreml/qnn/openvino NPU]           │
├──────────────────────────────────────────────────────────────┤
│  FORMAT   GGUF (native) ← safetensors converter               │
└──────────────────────────────────────────────────────────────┘
```

## Quickstart

Requires **Node 22+** (native TypeScript execution, zero build step for the core).

```bash
# Profile this device
npm run profile

# Auto-select the optimal model for this device
npm run plan                       # balanced
npm run plan -- --goal quality     # maximize accuracy
npm run plan -- --goal speed       # maximize tok/s
npm run plan -- --goal balanced --context 16384

# Run the test suite (planner physics + decision guards)
npm test --workspaces
```

## Status

| Component | State |
|---|---|
| Device profiler (Node) | ✅ reads real CPU/RAM/SIMD/accelerators |
| Auto-quant planner | ✅ memory + speed + quality model, goal-weighted, tested |
| Engine-abstraction interface + router | ✅ contract defined |
| Seed model catalog (GGUF) | ✅ 1.5B → 14B, real arch dims |
| llama.cpp engine binding | 🔜 next |
| OpenAI-compatible server | 🔜 next |
| Browser (WebGPU) profiler + engine | 🔜 |
| Mobile (iOS/Android) | 🔜 |

## Design principles

1. **Don't reinvent the kernel.** Orchestrate the best open engines; differentiate on UX + reach.
2. **Zero decisions for the user.** Every quant/backend/param choice is auto-derived and explained.
3. **GGUF-native.** Day-one access to the entire existing model universe; no proprietary format.
4. **Degrade safely, never crash.** A profiler that guesses conservatively beats one that throws.
5. **Memory & thermal first on mobile.** Size to the per-app budget, not the spec sheet.

## License

Apache-2.0. Core stays open forever.
