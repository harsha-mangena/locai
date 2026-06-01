# Design Document — locai-dashboard

## Architecture

See the full architecture diagram and component breakdown below. The system consists of three layers: the React dashboard (packages/dashboard), the extended LocAI server (packages/core/src/server/openai.ts), and the new core modules (ThinkingStreamParser, ToolRegistry, ToolExecutor, AgenticLoop, WebSearchTool).

## Components and Interfaces

See Part 1 (core extensions) and Part 2 (dashboard components) for all interfaces, class definitions, and component trees.

## Data Models

See Part 3 (data flow) and the API contract tables for all request/response shapes. Core types are extended in packages/core/src/types.ts with optional fields: `supportsReasoning`, `chatTemplate`, `samplingDefaults`.

## Correctness Properties

### Property 1: ThinkingStreamParser Round-Trip
For all strings S split into N chunks at arbitrary boundaries, the concatenation of all `thinking_token` content plus all `answer_token` content equals S exactly.

**Validates: Requirements 7.5**

### Property 2: ThinkingStreamParser No-Think Passthrough
For all strings S not containing `<think>`, all emitted events are `answer_token` events and no `thinking_token` events are emitted.

**Validates: Requirements 6.5, 7.1**

### Property 3: ThinkingStreamParser Split-Delimiter Invariance
For all strings S containing `<think>...</think>`, splitting S at any byte position and feeding the chunks sequentially produces the same thinking/answer split as feeding S as a single chunk.

**Validates: Requirements 6.6, 7.4**

### Property 4: ThinkingStreamParser Unclosed-Think Safety
For all strings of the form `<think>` + X with no closing `</think>`, all content is emitted as `answer_token` events and `done` is emitted exactly once.

**Validates: Requirements 7.6**

### Property 5: ToolExecutor Never-Throws
For all tool_call inputs (valid, invalid JSON args, unknown tool names, throwing execute functions), `ToolExecutor.execute()` always resolves and never rejects.

**Validates: Requirements 10.2, 10.3, 10.4**

### Property 6: AgenticLoop Termination Bound
For a mock model that always returns `tool_calls`, the loop emits `done` after at most `maxIterations` (default 10) iterations.

**Validates: Requirements 11.4, 11.5**

### Property 7: AgenticLoop No-Tools Fast Path
For requests without a `tools` array, the loop emits `token` events directly without emitting any `tool_call` events.

**Validates: Requirements 11.1, 11.3**

## Error Handling

- ThinkingStreamParser: unclosed `<think>` → flush as answer_token, never throws
- ToolExecutor: all errors returned as JSON strings, never throws or rejects
- AgenticLoop: max 10 iterations guard, appends warning to final response
- WebSearchTool: 10s timeout via AbortController, returns structured error result
- Dashboard localStorage: safeGet/safeSet wrappers catch quota errors, surface non-blocking toast
- Dashboard SSE: AbortController ref allows stop() to cancel in-flight stream

## Testing Strategy

Unit tests for ThinkingStreamParser, ToolExecutor, and AgenticLoop with property-based tests as described in Part 5. Integration tests for the extended server endpoints. Dashboard components tested with React Testing Library.

## Overview

This document covers the technical design for three interconnected features:
1. **Web Dashboard** (`packages/dashboard`) — React 19 + Vite + Tailwind v4 + shadcn/ui SPA
2. **Tool Use / Agentic Loop** (`packages/core`) — ToolRegistry, ToolExecutor, AgenticLoop
3. **Web Search + Reasoning Models** (`packages/core` + `packages/dashboard`)

The dashboard talks directly to the existing LocAI OpenAI-compatible server. No new backend is introduced. All new server-side logic extends `packages/core/src/server/openai.ts`.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  packages/dashboard  (React 19 + Vite + Tailwind v4)        │
│                                                             │
│  Sidebar │ ChatArea │ RightPanel                            │
│          │          │  WhyPanel / DevicePanel / ModelHub    │
│                                                             │
│  useChat() ──SSE──► /v1/chat/completions                    │
│  useModelHub() ────► /locai/models                          │
│  useLocaiPlan() ───► /locai/plan                            │
│  useDeviceProfile()► /locai/device                          │
│  useServerHealth()─► /health                                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE  (localhost:8080)
┌──────────────────────────▼──────────────────────────────────┐
│  packages/core/src/server/openai.ts  (extended)             │
│                                                             │
│  CORS + OPTIONS ──────────────────────────────────────────  │
│  GET  /health                                               │
│  GET  /locai/plan          ← StrategyPlan                   │
│  GET  /locai/device        ← DeviceProfile                  │
│  GET  /locai/models        ← ModelHub.status()              │
│  POST /locai/models/download                                │
│  DELETE /locai/models/:id/:quant                            │
│  GET  /v1/models                                            │
│  POST /v1/chat/completions ← AgenticLoop (if tools present) │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼──────────────────┐
         ▼                 ▼                  ▼
   AgenticLoop        ToolRegistry       ModelHub
   (agentic.ts)       (registry.ts)      (hub.ts)
         │                 │
         ▼                 ▼
   ToolExecutor       WebSearchTool
   (executor.ts)      (web-search.ts)
         │
         ▼
   LlamaCppEngine (llama-server process)
```

---

## Part 1: packages/core Extensions

### 1.1 Extended Type System (`src/types.ts`)

Add to `ModelDescriptor`:

```typescript
supportsReasoning?: boolean;
chatTemplate?: "llama3" | "chatml" | "deepseek-r1" | "qwen3" | "generic";
samplingDefaults?: {
  temperature: number;
  repeatPenalty: number;
};
```

No breaking changes — all new fields are optional.

### 1.2 ThinkingStreamParser (`src/engine/thinking-parser.ts`)

State machine with three states: `IDLE → THINKING → ANSWER`.

The key challenge is that SSE chunks can split delimiters (`<thi` + `nk>`). The parser maintains a `pending` buffer for partial delimiter detection.

```
State machine:
  IDLE    → sees "<think>"  → THINKING
  THINKING → sees "</think>" → ANSWER
  ANSWER  → terminal (emits answer_token until done)

  If stream ends in THINKING: flush pending as answer_token, emit done
```

**Interface:**
```typescript
type ParserEvent =
  | { type: "thinking_token"; token: string }
  | { type: "answer_token";   token: string }
  | { type: "done" };

class ThinkingStreamParser {
  push(token: string): ParserEvent[];  // returns 0..N events
  flush(): ParserEvent[];              // call at stream end
}
```

**Correctness properties (PBT):**
1. Round-trip: `concat(all thinking_tokens) + concat(all answer_tokens) === original` for all inputs
2. No-think passthrough: input without `<think>` → only `answer_token` events
3. Split-delimiter invariant: splitting input at any byte boundary produces same events
4. Unclosed-think: stream ending in THINKING state → all content emitted as `answer_token`

### 1.3 Tool System (`src/tools/`)

**`registry.ts` — ToolRegistry**

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  execute(args: Record<string, unknown>): Promise<string>;
}

class ToolRegistry {
  register(def: ToolDefinition): void;   // throws if name exists
  get(name: string): ToolDefinition | null;
  toOpenAITools(): OpenAITool[];         // { type:"function", function:{name,description,parameters} }
  list(): string[];
}
```

**`executor.ts` — ToolExecutor**

Never throws. All errors returned as structured strings.

```typescript
class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(toolCall: {
    id: string;
    name: string;
    arguments: string; // JSON string from model
  }): Promise<string>;
}
```

Error format: `{"error": "tool_not_found", "tool": "foo"}` — parseable by the model.

**Correctness properties (PBT):**
1. Unknown tool → returns JSON error string, never throws
2. Malformed JSON args → returns JSON error string, never throws
3. Throwing execute fn → returns JSON error string, never throws

### 1.4 WebSearchTool (`src/tools/web-search.ts`)

```typescript
interface SearchResult { title: string; url: string; snippet: string; }

// Registered as: registry.register(makeWebSearchTool())
function makeWebSearchTool(): ToolDefinition
```

**Backend selection:**
- `SEARXNG_URL` env set → SearXNG JSON API (`?q=...&format=json`)
- Otherwise → DuckDuckGo Instant Answers (`https://api.duckduckgo.com/?q=...&format=json&no_html=1`)

**HTML stripping:** regex-based (`/<[^>]+>/g`), no external deps.

**Limits:** 10s timeout via `AbortController`, max 3 calls tracked per agentic loop via a counter passed in context.

### 1.5 AgenticLoop (`src/server/agentic.ts`)

```typescript
type AgenticSSEEvent =
  | { event: "tool_call";   data: { id: string; name: string; arguments: Record<string,unknown> } }
  | { event: "tool_result"; data: { id: string; name: string; results: unknown } }
  | { event: "token";       data: { content: string; stop: boolean } }
  | { event: "done" };

async function* runAgenticLoop(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  registry: ToolRegistry,
  callModel: (messages: ChatMessage[], tools: OpenAITool[]) => Promise<ModelResponse>,
  opts?: { maxIterations?: number }  // default 10
): AsyncIterable<AgenticSSEEvent>
```

**Flow:**
```
iteration = 0
loop:
  response = callModel(messages, tools)
  if response.tool_calls:
    yield tool_call events
    for each tool_call:
      result = executor.execute(tool_call)
      yield tool_result event
      messages.push({ role: "tool", content: result, tool_call_id: id })
    messages.push(response as assistant message)
    iteration++
    if iteration >= maxIterations:
      yield warning token, break
  else:
    yield token events (stream final answer)
    break
yield done
```

**Correctness properties (PBT):**
1. Loop terminates in ≤ 10 iterations regardless of model always returning tool_calls
2. No-tools request: returns immediately without entering loop
3. Empty tool_calls array: treated as final answer

### 1.6 Extended `openai.ts` Server

**CORS — added to every response:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

**OPTIONS preflight:** returns 204 with CORS headers for all paths.

**New endpoints:**

| Method | Path | Handler |
|--------|------|---------|
| GET | `/locai/device` | `profileDevice()` → JSON |
| GET | `/locai/models` | `hub.status(device)` → JSON |
| POST | `/locai/models/download` | `hub.download(model, quant, plan)` → `{status:"started"}` |
| DELETE | `/locai/models/:modelId/:quantId` | `hub.evict(model, quant)` → `{status:"deleted"}` |

**Extended `/v1/chat/completions`:**
- If request body contains `tools` array → route through `runAgenticLoop`
- SSE events prefixed with `event:` line for tool_call/tool_result
- Regular token chunks remain as `data: {...}` (backward compatible)

### 1.7 Reasoning Models in Seed Catalog (`src/catalog/seed.ts`)

Two new entries:

```typescript
{
  id: "deepseek-r1-distill-qwen-1.5b",
  displayName: "DeepSeek-R1-Distill 1.5B",
  paramsB: 1.5,
  contextLength: 32768,
  gqa: true,
  supportsReasoning: true,
  chatTemplate: "deepseek-r1",
  samplingDefaults: { temperature: 0.6, repeatPenalty: 1.0 },
  // ... arch dims, quants
}

{
  id: "qwq-32b",
  displayName: "QwQ 32B",
  paramsB: 32.5,
  contextLength: 32768,
  gqa: true,
  supportsReasoning: true,
  chatTemplate: "qwen3",
  samplingDefaults: { temperature: 0.6, repeatPenalty: 1.0 },
  // ... arch dims, quants
}
```

### 1.8 Extended Chat Templates (`src/engine/chat-template.ts`)

**deepseek-r1 template:**
```
<|User|>{user_content}<|Assistant|><think>
```
The `<think>` at the end elicits chain-of-thought before the answer.

**qwen3 template:**
Uses ChatML format. Appends `/think` to the last user message to enable reasoning mode, or `/no_think` to disable it.

---

## Part 2: packages/dashboard

### 2.1 Package Setup

```
packages/dashboard/
  package.json          name: "@locai/dashboard"
  vite.config.ts        port 5173, proxy /api → localhost:8080 (dev only)
  tailwind.config.ts    v4 config
  index.html
  src/
    main.tsx
    App.tsx
    api/
    hooks/
    components/
    lib/
    store/
```

**package.json dependencies:**
```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "@tanstack/react-query": "^5.0.0",
  "react-markdown": "^9.0.0",
  "rehype-highlight": "^7.0.0",
  "highlight.js": "^11.0.0",
  "lucide-react": "^0.400.0",
  "clsx": "^2.0.0",
  "tailwind-merge": "^2.0.0"
}
```

shadcn/ui components used: Button, Input, Textarea, Sheet, Tabs, Badge, Progress, Skeleton, Separator, ScrollArea, Tooltip, Switch, Slider.

### 2.2 API Client (`src/api/client.ts`)

Typed fetch wrappers. Base URL read from settings (default `http://localhost:8080`).

```typescript
export const api = {
  health():                Promise<{ status: string }>,
  getPlan():               Promise<PlanResponse>,
  getDevice():             Promise<DeviceProfile>,
  getModels():             Promise<ModelStatus[]>,
  downloadModel(id, qid):  Promise<{ status: string }>,
  deleteModel(id, qid):    Promise<{ status: string }>,
  chatStream(req):         ReadableStream<AgenticSSEEvent>,
}
```

`chatStream` returns a `ReadableStream` that the `useChat` hook reads via `getReader()`.

### 2.3 Hooks

**`useServerHealth()`**
```typescript
// TanStack Query, refetchInterval: 5000, timeout: 3000
// Returns: { connected: boolean, isLoading: boolean }
```

**`useLocaiPlan()`**
```typescript
// TanStack Query, staleTime: 30_000
// Returns: { plan: PlanResponse | null, isLoading, error }
```

**`useDeviceProfile()`**
```typescript
// TanStack Query, staleTime: Infinity (device doesn't change)
// Returns: { device: DeviceProfile | null, isLoading, error }
```

**`useModelHub()`**
```typescript
// TanStack Query, refetchInterval: (data) => hasDownloading(data) ? 2000 : false
// Returns: { models: ModelStatus[], isLoading, download(id,qid), delete(id,qid) }
```

**`useSettings()`**
```typescript
// localStorage-backed, no server calls
// Returns: { settings: Settings, update(partial: Partial<Settings>) }
// Settings: { serverUrl, goal, maxTokens, temperature, contextLength }
// Defaults: { serverUrl:"http://localhost:8080", goal:"balanced", maxTokens:0, temperature:0.7, contextLength:4096 }
```

**`useConversations()`**
```typescript
// localStorage-backed
// Returns: { conversations, activeId, create(), select(id), rename(id,name), delete(id) }
```

**`useChat()`**
```typescript
// Core hook — manages the SSE stream
// Returns: {
//   messages: Message[],
//   isGenerating: boolean,
//   send(content: string): void,
//   stop(): void,
//   clear(): void,
// }

interface Message {
  id: string;
  role: "user" | "assistant";
  thinking?: string;        // content inside <think>...</think>
  answer: string;           // final answer content
  toolCalls?: ToolCallEvent[];
  citations?: Citation[];
  isStreaming?: boolean;
}
```

`useChat` internally:
1. Calls `api.chatStream()`
2. Reads SSE chunks via `ReadableStream.getReader()`
3. Parses event type: `tool_call`, `tool_result`, or default token
4. Feeds tokens through `ThinkingStreamParser`
5. Updates message state incrementally
6. Stores `AbortController` ref for stop()

### 2.4 Component Tree

```
App
├── ThemeProvider (class on <html>: "dark" | "light")
├── QueryClientProvider
└── AppLayout (CSS grid: sidebar | main | right-panel)
    ├── ConnectionStatus          ← top bar, green/red dot + server URL
    ├── Sidebar (240px)
    │   ├── NewChatButton
    │   ├── ConversationList
    │   │   └── ConversationItem (click=select, right-click=rename/delete)
    │   └── SettingsButton → SettingsSheet (shadcn Sheet)
    ├── ChatArea (flex-col, flex-1)
    │   ├── MessageList (ScrollArea, auto-scroll to bottom)
    │   │   └── MessageBubble (per message)
    │   │       ├── ReasoningPanel?  (Collapsible, shows thinking token count)
    │   │       ├── ToolCallIndicator? (per tool call, collapsible)
    │   │       ├── MarkdownContent  (react-markdown + rehype-highlight)
    │   │       └── CitationsPanel?  (collapsible, links to sources)
    │   └── ChatInput
    │       ├── Textarea (auto-resize, Enter=send, Shift+Enter=newline)
    │       ├── SendButton (disabled while generating)
    │       └── StopButton (visible while generating, Escape key)
    └── RightPanel (320px, collapsible via toggle button)
        └── Tabs: "Why" | "Device" | "Models"
            ├── WhyPanel
            │   ├── ModelBadge (name + quant + backend)
            │   ├── FitClassBadge (color-coded)
            │   ├── MetricsRow (tok/s, memory %, quality %)
            │   └── RationaleList (one line per rationale entry)
            ├── DevicePanel
            │   ├── PlatformRow
            │   ├── CpuRow
            │   ├── RamRow (total + usable)
            │   ├── BandwidthRow
            │   ├── ThermalBadge?
            │   └── AcceleratorList
            └── ModelHubPanel
                ├── StorageUsageBar
                └── ModelCard[] (per model × quant)
                    ├── ModelInfo (name, params, size)
                    ├── AvailabilityBadge
                    ├── DownloadProgress? (Progress bar)
                    └── ActionButton (Download | Delete | Active)
```

### 2.5 Layout & Styling

CSS Grid layout for AppLayout:
```css
grid-template-columns: 240px 1fr 320px;
grid-template-rows: 40px 1fr;
/* ConnectionStatus spans all 3 columns in row 1 */
/* Sidebar, ChatArea, RightPanel in row 2 */
```

RightPanel collapses to 0px with CSS transition. Toggle button sits at the border.

Color tokens (Tailwind v4 CSS variables):
- `--color-surface`: chat background
- `--color-bubble-user`: user message bg
- `--color-bubble-assistant`: assistant message bg
- `--color-thinking`: reasoning panel bg (slightly different tint)
- `--color-tool`: tool call indicator bg

FitClassBadge colors:
- `comfortable` → green (`bg-green-500/20 text-green-700`)
- `tight` → yellow (`bg-yellow-500/20 text-yellow-700`)
- `thrash` → orange (`bg-orange-500/20 text-orange-700`)
- `over-cliff` → red (`bg-red-500/20 text-red-700`)

### 2.6 Stream Reading (`src/lib/stream-reader.ts`)

```typescript
async function* readSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<{ event?: string; data: string }> {
  // Reads chunks, splits on \n\n, parses event: and data: lines
  // Handles partial chunks across reads
}
```

Used by `useChat` to iterate over SSE events from the server.

### 2.7 Storage (`src/lib/storage.ts`)

```typescript
function safeGet<T>(key: string, fallback: T): T
function safeSet(key: string, value: unknown): boolean  // returns false on quota error
function safeRemove(key: string): void
```

All localStorage access goes through these. Errors are caught and surfaced via a React context toast, not thrown.

### 2.8 ThinkingStreamParser (browser copy)

`src/lib/thinking-parser.ts` — identical logic to `packages/core/src/engine/thinking-parser.ts`. Duplicated (not imported) to keep the dashboard bundle free of Node.js dependencies. Both files are tested independently.

---

## Part 3: Data Flow — Chat with Web Search

End-to-end flow for "What are the latest AI trends in 2026?":

```
User types → ChatInput.send()
  → useChat.send(content)
    → api.chatStream({ messages, tools: [web_search], stream: true })
      → POST /v1/chat/completions (with tools)
        → AgenticLoop.run()
          → callModel(messages, tools)
            → llama-server /v1/chat/completions
              ← model emits tool_call: web_search("AI trends 2026")
          → ToolExecutor.execute(tool_call)
            → WebSearchTool.execute({ query: "AI trends 2026", num_results: 5 })
              → DuckDuckGo API / SearXNG
              ← [{ title, url, snippet }, ...]
          → yield SSE: event:tool_call data:{...}
          → yield SSE: event:tool_result data:{...}
          → callModel(messages + tool_result)
            → llama-server (now with search context)
              ← streams final answer tokens
          → yield SSE: data:{content:"Based on...", stop:false}
          → yield SSE: data:{content:"", stop:true}

  ← useChat reads SSE stream
    → ThinkingStreamParser.push(token) per token
      → if reasoning model: splits <think> from answer
    → updates message state:
        { thinking: "...", answer: "Based on...", citations: [...] }
    → React re-renders MessageBubble incrementally
      → ReasoningPanel (collapsed, shows "247 thinking tokens")
      → MarkdownContent (streams answer)
      → CitationsPanel (shows 5 sources)
```

---

## Part 4: File Structure Summary

```
packages/core/src/
  types.ts                    ← +supportsReasoning, chatTemplate, samplingDefaults
  engine/
    thinking-parser.ts        ← NEW: ThinkingStreamParser
    chat-template.ts          ← +deepseek-r1, qwen3 templates
    llamacpp.ts               ← unchanged
    index.ts                  ← unchanged
  tools/
    registry.ts               ← NEW: ToolRegistry, ToolDefinition
    executor.ts               ← NEW: ToolExecutor
    web-search.ts             ← NEW: WebSearchTool
  server/
    agentic.ts                ← NEW: AgenticLoop
    openai.ts                 ← EXTENDED: CORS, new endpoints, tools support
  catalog/
    seed.ts                   ← +deepseek-r1-distill-1.5b, qwq-32b
    hub.ts                    ← unchanged
    resolver.ts               ← unchanged

packages/dashboard/
  package.json
  vite.config.ts
  tailwind.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    api/
      client.ts
      types.ts
    hooks/
      useServerHealth.ts
      useLocaiPlan.ts
      useDeviceProfile.ts
      useModelHub.ts
      useConversations.ts
      useSettings.ts
      useChat.ts
    components/
      layout/
        AppLayout.tsx
        Sidebar.tsx
        RightPanel.tsx
      chat/
        ChatArea.tsx
        MessageList.tsx
        MessageBubble.tsx
        ReasoningPanel.tsx
        ToolCallIndicator.tsx
        CitationsPanel.tsx
        MarkdownContent.tsx
        ChatInput.tsx
      panels/
        WhyPanel.tsx
        DevicePanel.tsx
        ModelHubPanel.tsx
        ModelCard.tsx
        SettingsSheet.tsx
      ui/
        ConnectionStatus.tsx
        FitClassBadge.tsx
        SkeletonCard.tsx
    lib/
      storage.ts
      thinking-parser.ts
      stream-reader.ts
    store/
      conversations.ts
```

---

## Part 5: Property-Based Testing Plan

### ThinkingStreamParser (packages/core)

File: `src/engine/thinking-parser.test.ts`

```
Property 1 — Round-trip
  For all strings S split into N chunks at arbitrary boundaries:
  concat(thinking_tokens) + concat(answer_tokens) === S

Property 2 — No-think passthrough
  For all strings S not containing "<think>":
  all emitted events are answer_token

Property 3 — Split-delimiter invariance
  For all strings S containing "<think>...</think>":
  splitting S at any position produces same thinking/answer split

Property 4 — Unclosed-think safety
  For all strings S = "<think>" + X (no closing tag):
  all content emitted as answer_token, no events lost
```

### ToolExecutor (packages/core)

File: `src/tools/executor.test.ts`

```
Property 1 — Never throws
  For all tool_call inputs (valid, invalid, unknown):
  execute() always resolves (never rejects)

Property 2 — Error format
  For unknown tool names:
  result is valid JSON with "error" key

Property 3 — Malformed args
  For non-JSON argument strings:
  result is valid JSON with "error" key
```

### AgenticLoop (packages/core)

File: `src/server/agentic.test.ts`

```
Property 1 — Termination bound
  For a mock model that always returns tool_calls:
  loop emits "done" after exactly maxIterations iterations

Property 2 — No-tools fast path
  For requests without tools array:
  loop emits token events directly without tool_call events
```

---

## Part 6: Monorepo Integration

Add to root `package.json` scripts:
```json
{
  "dev:dashboard": "npm run dev --workspace=packages/dashboard",
  "build:dashboard": "npm run build --workspace=packages/dashboard"
}
```

Add `packages/dashboard` to root `workspaces` array.

The dashboard dev server proxies `/api` to `localhost:8080` in development. In production, the static bundle is served by any static file server; the server URL is configured in Settings.

---

## Part 7: Key Design Decisions

**Why no new backend?**
The existing `openai.ts` server already runs as a Node process. Adding endpoints there keeps the stack minimal — one process, one port, no Docker required.

**Why duplicate ThinkingStreamParser in the dashboard?**
The dashboard bundle must not import Node.js modules. Duplicating the pure-logic parser (no deps) is cleaner than a complex build configuration. Both copies are tested independently with the same property tests.

**Why DuckDuckGo as the zero-config search fallback?**
No API key required. The Instant Answers API is public and returns JSON. SearXNG is the privacy-first upgrade path for users who want full control.

**Why TanStack Query for server state?**
It handles stale-while-revalidate, background refetch intervals (critical for download progress), and error states out of the box. No custom polling logic needed.

**Why shadcn/ui over a full component library?**
shadcn copies components into the project — no runtime dependency, full control over styling, Tailwind v4 compatible. The 2025/2026 standard for new React projects.
