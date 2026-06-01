# Implementation Plan: locai-dashboard

## Overview

18 tasks implementing the LocAI dashboard, tool use, web search, and reasoning model support. Tasks are ordered by dependency: core type extensions first, then new core modules, then server extensions, then the dashboard package.

## Tasks

- [x] 1. Extend core types with reasoning model fields
  - Add `supportsReasoning?: boolean`, `chatTemplate?: "llama3" | "chatml" | "deepseek-r1" | "qwen3" | "generic"`, and `samplingDefaults?: { temperature: number; repeatPenalty: number }` to `ModelDescriptor` in `packages/core/src/types.ts`
  - All new fields are optional — no breaking changes to existing code or tests
  - _Requirements: 8.3, 8.4_

- [x] 2. Implement ThinkingStreamParser
  - Create `packages/core/src/engine/thinking-parser.ts`
  - State machine: IDLE → THINKING → ANSWER with `pending` buffer for partial delimiter detection across SSE chunks
  - `push(token: string): ParserEvent[]` — returns 0..N events per call
  - `flush(): ParserEvent[]` — if still in THINKING state, emits all buffered content as `answer_token` then `done`
  - Export `ParserEvent` union type: `{ type: "thinking_token"; token: string } | { type: "answer_token"; token: string } | { type: "done" }`
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 3. Write ThinkingStreamParser property-based tests
  - Create `packages/core/src/engine/thinking-parser.test.ts`
  - Property 1 (round-trip): for strings split at random positions, concat(thinking+answer) === original
  - Property 2 (no-think passthrough): strings without `<think>` produce only `answer_token` events
  - Property 3 (split-delimiter): `<think>` split across chunk boundaries produces same result as single chunk
  - Property 4 (unclosed-think): stream ending in THINKING state emits all content as `answer_token`
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 4. Implement ToolRegistry and ToolExecutor
  - Create `packages/core/src/tools/registry.ts` with `ToolDefinition` interface and `ToolRegistry` class
  - `register(def)` throws if name already exists; `get(name)` returns `ToolDefinition | null`; `toOpenAITools()` returns OpenAI-format array; `list()` returns names
  - Create `packages/core/src/tools/executor.ts` with `ToolExecutor` class
  - `execute(toolCall)` never throws; returns JSON error string on unknown tool, malformed JSON args, or throwing execute function
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 5. Write ToolExecutor property-based tests
  - Create `packages/core/src/tools/executor.test.ts`
  - Property 1: unknown tool → resolves with JSON string containing `"error"` key, never rejects
  - Property 2: malformed JSON args → resolves with JSON string containing `"error"` key, never rejects
  - Property 3: throwing execute fn → resolves with JSON string containing `"error"` key, never rejects
  - Test sequential execution of multiple tool_calls in one response
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 6. Implement WebSearchTool
  - Create `packages/core/src/tools/web-search.ts`
  - Export `makeWebSearchTool(): ToolDefinition` registered as `web_search`
  - Parameters: `query` (string, required), `num_results` (integer, optional, default 5, max 10)
  - SearXNG backend when `SEARXNG_URL` env is set; DuckDuckGo Instant Answers API otherwise
  - HTML stripping via `/<[^>]+>/g` regex — no external deps
  - 10s timeout via `AbortController`; on failure returns structured error JSON string, never throws
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [x] 7. Implement AgenticLoop
  - Create `packages/core/src/server/agentic.ts`
  - Export `runAgenticLoop(messages, tools, registry, callModel, opts?)` as async generator
  - Yields `AgenticSSEEvent`: `tool_call | tool_result | token | done`
  - Max 10 iterations guard (configurable via `opts.maxIterations`); on limit yields warning token then `done`
  - No-tools fast path: if `tools` is empty/undefined, yields token events directly without entering loop
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 8. Write AgenticLoop tests
  - Create `packages/core/src/server/agentic.test.ts`
  - Property 1 (termination bound): mock model always returning tool_calls → loop emits `done` after ≤ maxIterations
  - Property 2 (no-tools fast path): request without tools → no `tool_call` events emitted, `done` emitted
  - Test: empty tool_calls array in model response treated as final answer
  - _Requirements: 11.1, 11.3, 11.4, 11.5_

- [x] 9. Extend openai.ts — CORS, preflight, and new management endpoints
  - Add CORS headers (`Access-Control-Allow-Origin: *`, methods, headers) to all responses in `packages/core/src/server/openai.ts`
  - Handle `OPTIONS` preflight: return 204 with CORS headers for all paths
  - Add `GET /locai/device` → `profileDevice()` as JSON
  - Add `GET /locai/models` → `hub.status(device)` including `downloadProgress` fraction
  - Add `POST /locai/models/download` → `hub.download()` → `{ status: "started" }`; 404 if modelId or quantId not found
  - Add `DELETE /locai/models/:modelId/:quantId` → `hub.evict()` → `{ status: "deleted" }`
  - _Requirements: 15.6, 16.1, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 19.1, 19.2, 19.3_

- [x] 10. Extend openai.ts — tools support in /v1/chat/completions
  - When request body contains `tools` array, route through `runAgenticLoop` instead of direct generation
  - Stream `tool_call` and `tool_result` SSE events with `event:` prefix before final answer stream
  - Regular token chunks remain as `data: {...}` (backward compatible)
  - Wire up `ToolRegistry` with `WebSearchTool` registered at server startup
  - _Requirements: 11.1, 11.2, 11.6, 12.6, 13.1_

- [x] 11. Add reasoning models to seed catalog and extend chat templates
  - Add `deepseek-r1-distill-qwen-1.5b` to `packages/core/src/catalog/seed.ts` with `supportsReasoning: true`, `chatTemplate: "deepseek-r1"`, `samplingDefaults: { temperature: 0.6, repeatPenalty: 1.0 }`, and real arch dims (paramsB 1.5, contextLength 32768, gqa true, numAttentionHeads 12, numKeyValueHeads 2, hiddenSize 1536, numLayers 28)
  - Add `qwq-32b` with `supportsReasoning: true`, `chatTemplate: "qwen3"`, `samplingDefaults: { temperature: 0.6, repeatPenalty: 1.0 }`, and real arch dims (paramsB 32.5, contextLength 32768, gqa true, numAttentionHeads 40, numKeyValueHeads 8, hiddenSize 5120, numLayers 64)
  - Extend `packages/core/src/engine/chat-template.ts`: add `deepseek-r1` template (`<|User|>{content}<|Assistant|><think>\n`) and `qwen3` template (ChatML with `/think` suffix on last user message)
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 12. Set up packages/dashboard package
  - Create `packages/dashboard/package.json` (name `@locai/dashboard`), `vite.config.ts` (port 5173, dev proxy), `tailwind.config.ts` (v4 with CSS variable color tokens), `index.html`, `src/main.tsx`
  - Dependencies: React 19, Vite 6, TypeScript, Tailwind CSS v4, TanStack Query v5, react-markdown, rehype-highlight, lucide-react, clsx, tailwind-merge
  - Add `packages/dashboard` to root `package.json` workspaces; add `dev:dashboard` and `build:dashboard` scripts
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 13. Implement API client and lib utilities
  - Create `packages/dashboard/src/api/client.ts` — typed fetch wrappers: `health()`, `getPlan()`, `getDevice()`, `getModels()`, `downloadModel()`, `deleteModel()`, `chatStream()`; base URL from settings
  - Create `packages/dashboard/src/api/types.ts` — API response types
  - Create `packages/dashboard/src/lib/storage.ts` — `safeGet`, `safeSet`, `safeRemove` with error handling
  - Create `packages/dashboard/src/lib/stream-reader.ts` — `readSSEStream` async generator parsing SSE chunks
  - Create `packages/dashboard/src/lib/thinking-parser.ts` — browser copy of ThinkingStreamParser (no Node deps)
  - _Requirements: 2.1, 2.4, 5.5_

- [x] 14. Implement data hooks
  - Create `useServerHealth.ts` (TanStack Query, 5s refetch, 3s timeout → `{ connected, isLoading }`)
  - Create `useLocaiPlan.ts` (TanStack Query, 30s staleTime)
  - Create `useDeviceProfile.ts` (TanStack Query, staleTime Infinity)
  - Create `useModelHub.ts` (TanStack Query, 2s refetch when any model is downloading; exposes `download()` and `delete()` mutations)
  - Create `useSettings.ts` (localStorage-backed, defaults: goal "balanced", maxTokens 0, temperature 0.7, contextLength 4096, serverUrl "http://localhost:8080")
  - Create `useConversations.ts` (localStorage CRUD: create, select, rename, delete)
  - Create `useChat.ts` (SSE stream via `readSSEStream`, feeds tokens through `ThinkingStreamParser`, `AbortController` ref for `stop()`, updates `Message[]` state incrementally)
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.1, 3.5, 4.2, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.6, 15.3, 15.7, 17.2, 17.3_

- [x] 15. Implement layout components
  - Create `AppLayout.tsx` — CSS grid (240px sidebar | 1fr chat | 320px right panel), ConnectionStatus top bar spanning all columns
  - Create `Sidebar.tsx` — NewChatButton, ConversationList with rename/delete context menu, SettingsButton
  - Create `RightPanel.tsx` — collapsible 320px panel with Tabs (Why / Device / Models), CSS transition on collapse
  - Create `ConnectionStatus.tsx` — green/red dot, server URL, reconnect prompt when disconnected
  - _Requirements: 1.6, 2.2, 2.3, 2.4_

- [x] 16. Implement chat components
  - Create `ChatArea.tsx`, `MessageList.tsx` (ScrollArea, auto-scroll to bottom)
  - Create `MessageBubble.tsx` — routes to ReasoningPanel, ToolCallIndicator, MarkdownContent, CitationsPanel based on message fields
  - Create `ReasoningPanel.tsx` — collapsible (default collapsed), shows thinking token count in toggle label
  - Create `ToolCallIndicator.tsx` — collapsible, shows tool name and args summary; paired with result when received
  - Create `CitationsPanel.tsx` — collapsible (expanded for latest message, collapsed for older), clickable source links opening in new tab
  - Create `MarkdownContent.tsx` — react-markdown with rehype-highlight for syntax-highlighted code blocks
  - Create `ChatInput.tsx` — auto-resize Textarea (Enter=send, Shift+Enter=newline), SendButton (disabled while generating), StopButton (visible while generating, Escape key aborts)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 13.2, 13.3, 13.4, 13.5, 14.1, 14.2, 14.3, 14.4_

- [x] 17. Implement right panel components
  - Create `WhyPanel.tsx` — ModelBadge, FitClassBadge (green/yellow/orange/red), MetricsRow (tok/s, memory %, quality %), RationaleList; skeleton while loading; error message on failure
  - Create `FitClassBadge.tsx` — color-coded badge for comfortable/tight/thrash/over-cliff
  - Create `DevicePanel.tsx` — platform, CPU, RAM rows, bandwidth, ThermalBadge, AcceleratorList; skeleton while loading
  - Create `ModelHubPanel.tsx` — StorageUsageBar + ModelCard list
  - Create `ModelCard.tsx` — name, params, size, AvailabilityBadge, DownloadProgress bar (when downloading), Download/Delete action button
  - Create `SettingsSheet.tsx` — goal selector, max tokens input, temperature slider (0–2, step 0.01), context length input, server URL field; all changes persisted to localStorage immediately
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.7, 16.2, 16.3, 16.4, 16.5, 17.1, 17.2, 17.3, 17.4, 17.5_

- [x] 18. Wire up App.tsx, store, and verify end-to-end
  - Create `packages/dashboard/src/store/conversations.ts` — useReducer-based conversation state
  - Create `packages/dashboard/src/App.tsx` — composes ThemeProvider, QueryClientProvider, AppLayout
  - Verify dark/light mode toggle with OS preference as default
  - Verify full chat flow: send message → stream tokens → display in MessageBubble with correct reasoning/tool/citation panels
  - _Requirements: 1.6, 4.6, 4.7, 5.1, 5.2_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": [1] },
    { "wave": 2, "tasks": [2, 4, 12] },
    { "wave": 3, "tasks": [3, 5, 6, 11, 13] },
    { "wave": 4, "tasks": [7] },
    { "wave": 5, "tasks": [8, 9] },
    { "wave": 6, "tasks": [10, 14] },
    { "wave": 7, "tasks": [15] },
    { "wave": 8, "tasks": [16, 17] },
    { "wave": 9, "tasks": [18] }
  ]
}
```

## Notes

- Tasks 1–11 are all in `packages/core`. Tasks 12–18 are all in `packages/dashboard`.
- Tasks 3, 5, 8 are the property-based test tasks — they must run after their implementation tasks.
- Tasks 9 and 10 both modify `openai.ts`; do them sequentially.
- Task 13 includes the browser copy of ThinkingStreamParser — keep it in sync with Task 2's implementation.
- The existing 37 planner + strategy tests must continue to pass after all tasks complete.
