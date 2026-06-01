# Implementation Plan: locai-agent-browser

## Overview

This plan implements three new packages (`@locai/cli`, `@locai/agent`, `@locai/browser`) and extends the existing server and dashboard. Tasks are ordered by dependency: shared infrastructure first, then independent packages in parallel, then integration and wiring.

## Tasks

- [x] 1. Set up package scaffolding and shared types
  - [x] 1.1 Create `packages/agent` package structure
    - Create `packages/agent/package.json` with name `@locai/agent`, type module, dependency on `@locai/core`
    - Create `packages/agent/tsconfig.json`
    - Create `packages/agent/src/index.ts`, `src/types.ts`, `src/events.ts`, `src/runner.ts` stub files
    - _Requirements: 8.6_

  - [x] 1.2 Create `packages/cli` package structure
    - Create `packages/cli/package.json` with name `@locai/cli`, bin entry for `lai`, dependency on `@locai/core`
    - Create `packages/cli/tsconfig.json`
    - Create directory structure: `src/index.ts`, `src/repl.ts`, `src/context.ts`, `src/session.ts`, `src/permission.ts`, `src/renderer.ts`, `src/config.ts`, `src/system-prompt.ts`, `src/quality.ts`, `src/tools/index.ts`
    - _Requirements: 1.6_

  - [x] 1.3 Create `packages/browser` package structure
    - Create `packages/browser/package.json` with name `@locai/browser`, dependency on `@locai/core` and `@wllama/wllama`
    - Create `packages/browser/tsconfig.json`
    - Create `src/index.ts`, `src/wasm-engine.ts`, `src/webgpu-engine.ts`, `src/model-cache.ts`, `src/progress.ts`, `src/supports.ts` stub files
    - _Requirements: 20.5_

  - [x] 1.4 Extend `@locai/core` exports for browser entry point
    - Add `"./browser"` export to `packages/core/package.json` exports map pointing to a new `src/browser.ts` barrel
    - Ensure browser engines are tree-shakeable (not imported from main entry)
    - _Requirements: 20.4, 20.5_

- [ ] 2. Implement Agent SDK (`@locai/agent`)
  - [-] 2.1 Implement event types and shared types
    - Define `AgentEvent` discriminated union in `src/events.ts`
    - Define `AgentConfig`, `RunOptions`, `RunResult`, `ToolCallRecord` in `src/types.ts`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [~] 2.2 Implement `AgentRunner` class core
    - Implement constructor accepting `AgentConfig`
    - Implement `registerTool()` with name conflict detection and JSON Schema validation
    - Extend `EventEmitter` with typed event overloads
    - _Requirements: 8.1, 8.4, 9.1, 9.2, 9.3, 9.4_

  - [~] 2.3 Implement `AgentRunner.run()` method
    - Connect to `POST /locai/agent/run` with SSE streaming via `fetch`
    - Parse SSE events and emit typed `AgentEvent` events
    - Support `AbortSignal` cancellation (call `POST /locai/agent/stop` on abort)
    - Accumulate `RunResult` with final answer, tool call history, token count, iterations
    - _Requirements: 8.2, 8.3, 8.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [~] 2.4 Write unit tests for `AgentRunner`
    - Test tool registration with conflict detection
    - Test JSON Schema validation at registration time
    - Test event emission sequence matches conversation reconstruction (round-trip property)
    - _Requirements: 9.3, 9.4, 10.7_

- [ ] 3. Implement server agent endpoints
  - [-] 3.1 Add agent task state management to server
    - Define `AgentTask` interface and `PendingApproval` deferred pattern in `packages/core/src/server/openai.ts`
    - Implement in-memory `Map<string, AgentTask>` for tracking active tasks
    - _Requirements: 23.1, 23.3_

  - [~] 3.2 Implement `POST /locai/agent/run` endpoint
    - Accept `{ task, tools?, autoApprove? }` request body
    - Register coding tools in a per-task `ToolRegistry`
    - Start `runAgenticLoop` and stream SSE events (`tool_call`, `tool_result`, `token`, `thinking`, `approval_required`, `done`, `error`)
    - Suspend loop on destructive tool calls when `autoApprove` is false using deferred Promise pattern
    - _Requirements: 23.1, 23.2, 23.3, 23.6_

  - [~] 3.3 Implement `POST /locai/agent/approve` endpoint
    - Accept `{ taskId, actionId, approved }` and resolve the pending approval Promise
    - Resume or reject the suspended agentic loop
    - _Requirements: 23.4_

  - [~] 3.4 Implement `POST /locai/agent/stop` endpoint
    - Accept `{ taskId }` and abort the running task via `AbortController`
    - Clean up task state
    - _Requirements: 23.5_

  - [~] 3.5 Write unit tests for agent endpoints
    - Test SSE event stream format
    - Test approval flow suspend/resume
    - Test stop/abort behavior
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

- [~] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement CLI coding tools
  - [-] 5.1 Implement `file_read` tool
    - Read file contents, support `startLine`/`endLine` parameters
    - Return structured error for files >100KB with size info and suggestion
    - _Requirements: 3.2, 3.10_

  - [-] 5.2 Implement `file_write` tool
    - Write content to path, create parent directories as needed
    - Mark as requiring permission
    - _Requirements: 3.3_

  - [-] 5.3 Implement `shell_exec` tool
    - Execute command in project root, return stdout/stderr/exitCode
    - Enforce 30-second timeout, kill process and return timeout error on exceed
    - Mark as requiring permission
    - _Requirements: 3.4, 3.9_

  - [-] 5.4 Implement `grep_search`, `git_status`, `git_diff`, `web_fetch` tools
    - `grep_search`: search files with pattern, respect gitignore, return file/line/content
    - `git_status`: return staged/unstaged/untracked files
    - `git_diff`: return unified diff of uncommitted changes
    - `web_fetch`: fetch URL, truncate response to 8192 chars
    - _Requirements: 3.5, 3.6, 3.7, 3.8_

  - [~] 5.5 Implement tool registration index
    - Create `src/tools/index.ts` that registers all 7 coding tools in a `ToolRegistry`
    - _Requirements: 3.1_

  - [~] 5.6 Write unit tests for coding tools
    - Test file_read error on large files
    - Test shell_exec timeout behavior
    - Test grep_search gitignore filtering
    - _Requirements: 3.9, 3.10_

- [ ] 6. Implement CLI core systems
  - [~] 6.1 Implement project context scanner (`src/context.ts`)
    - Scan for `package.json`, `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `.gitignore`, `Makefile`, `README.md`
    - Extract language, framework, package manager, test runner, build tool
    - Respect `.gitignore` patterns for file operations
    - Limit context summary to 4096 tokens
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [~] 6.2 Implement config loader (`src/config.ts`)
    - Load `.lai.json` or `.lai.yaml` from project root
    - Parse persona, autoApprove, customInstructions, serverUrl, maxIterations
    - Apply sensible defaults when no config file exists
    - _Requirements: 2.5, 2.6_

  - [~] 6.3 Implement permission system (`src/permission.ts`)
    - `requiresApproval()`: return true for `file_write` and `shell_exec`
    - `prompt()`: display diff/command and prompt user for y/n/a
    - `grantAlways()`: auto-approve tool type for session remainder
    - Respect `autoApprove` config from `.lai.json`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [~] 6.4 Implement session manager (`src/session.ts`)
    - Save sessions to `~/.locai/sessions/{session_id}.json`
    - Load latest or by ID, list all sessions
    - Auto-generate session ID from project name + timestamp
    - Summarize old messages when history exceeds 32768 tokens
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [~] 6.5 Implement system prompt builder (`src/system-prompt.ts`)
    - Compose system prompt with role, project context, tool descriptions, behavioral guidelines
    - Support persona override from `.lai.json`
    - Instruct model to use tools proactively and explain before destructive ops
    - Keep total between 256–1024 tokens, truncate tool descriptions if needed
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 21.5_

  - [~] 6.6 Implement quality warning system (`src/quality.ts`)
    - Check model `baseCapability` at session start, warn if below 0.70
    - Track tool-call success rate, warn if below 50% after 4+ calls
    - Handle malformed tool calls: warn and retry once
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 7. Implement CLI entry point and REPL
  - [~] 7.1 Implement CLI entry point (`src/index.ts`)
    - Parse args: bare `lai`, `lai "task"`, `--resume`, `--resume {id}`, `--sessions`, `--model {id}`
    - Connect to LocAI server at `http://localhost:8080`, auto-start if not running (15s timeout)
    - Detect project root from cwd
    - Display startup banner with model name and capability score
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 21.1, 21.2, 21.3_

  - [~] 7.2 Implement REPL loop (`src/repl.ts`)
    - Interactive readline-based REPL
    - Stream tokens to stdout in real time (no buffering)
    - Render thinking traces in dimmed/gray color
    - Display tool call name + one-line summary in distinct color
    - Handle Ctrl+C: abort generation, show partial if tokens produced, else return to prompt
    - Display token count and tok/s after complete responses only
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [~] 7.3 Implement terminal renderer (`src/renderer.ts`)
    - Streaming output with ANSI colors
    - Diff display for file_write permission prompts (unified diff format)
    - Tool call formatting
    - _Requirements: 5.1, 5.2, 5.3, 4.1_

  - [~] 7.4 Wire CLI components together
    - Connect entry point → config → context → session → REPL → permission → tools → server
    - Handle `lai "task"` inline mode: execute task then return to REPL
    - Handle model change notification and session restart offer
    - _Requirements: 1.4, 21.4_

  - [~] 7.5 Write unit tests for CLI core
    - Test project context scanning
    - Test session persistence and resumption
    - Test permission system approve/reject/always flow
    - _Requirements: 2.1, 6.1, 4.3, 4.4, 4.5_

- [~] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement browser ModelCache (shared OPFS storage)
  - [~] 9.1 Implement `ModelCache` class
    - OPFS path derivation: `/models/{modelId}/{quantId}.gguf`
    - `has()`, `get()`, `ensure()`, `getCachedModels()`, `deleteModel()` methods
    - Deduplicate concurrent downloads for the same model
    - Support HTTP Range requests for download resume
    - Emit `DownloadProgress` events during download
    - Fall back to in-memory loading if OPFS unavailable, with warning
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 19.5_

  - [-] 9.2 Implement progress event types (`src/progress.ts`)
    - Define `DownloadProgress` interface with phases: `download`, `load`, `ready`
    - Include `bytesLoaded`, `bytesTotal`, `fraction` fields
    - _Requirements: 19.1, 19.2, 19.4_

  - [-] 9.3 Implement capability detection helpers (`src/supports.ts`)
    - `isWebGPUAvailable()`: check `navigator.gpu` and adapter availability
    - `probeGPULimits()`: get `maxBufferSize`, `maxStorageBufferBindingSize`
    - `isOPFSAvailable()`: check Origin Private File System support
    - _Requirements: 17.1, 17.4, 16.3_

- [ ] 10. Implement browser WASM engine
  - [~] 10.1 Implement `WasmEngine` class
    - Implement `InferenceEngine` interface: `info`, `supports`, `load`, `generate`, `unload`
    - Use `@wllama/wllama` for WASM-based GGUF inference
    - `info.backends` = `["wasm"]`, `info.name` = `"wllama"`
    - `load`: check OPFS cache → download if missing → initialize wllama → emit ready
    - `generate`: stream tokens as `GenerateChunk` async iterable; throw if no model loaded
    - `unload`: free WASM memory, verify cleanup, report failure if memory persists
    - Support `GenerateParams`: prompt, maxTokens, temperature, topP, topK, stop
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [~] 10.2 Expose cache management methods on `WasmEngine`
    - `getCachedModels()` delegates to `ModelCache`
    - `deleteModel(modelId, quantId)` delegates to `ModelCache`
    - _Requirements: 15.5, 15.6_

  - [~] 10.3 Write unit tests for WasmEngine
    - Test generate throws when no model loaded
    - Test info reports correct backends and name
    - _Requirements: 14.4, 14.6_

- [ ] 11. Implement browser WebGPU engine
  - [~] 11.1 Implement `WebGPUEngine` class
    - Implement `InferenceEngine` interface: `info`, `supports`, `load`, `generate`, `unload`
    - `info.backends` = `["webgpu"]`, `info.name` = `"webgpu-llama"`
    - `supports`: check `navigator.gpu` available and adapter obtainable
    - `load`: request adapter/device → check limits vs model size → load from shared OPFS cache → init compute pipelines → emit ready
    - `generate`: GPU-accelerated token streaming; emit error on device lost
    - `unload`: release GPU buffers, destroy device
    - Support same `GenerateParams` as WasmEngine
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [~] 11.2 Implement `WebGPUEngine.checkCapability()` static method
    - Probe GPU adapter limits for memory assessment
    - Return `{ available, maxBufferSize, maxStorageBufferBindingSize }`
    - _Requirements: 17.4_

  - [~] 11.3 Integrate WebGPU fallback behavior
    - On device lost or OOM at runtime: emit error event
    - Strategy cascade falls back to WasmEngine for remainder of session
    - _Requirements: 17.5_

  - [~] 11.4 Write unit tests for WebGPUEngine
    - Test supports() returns false when navigator.gpu unavailable
    - Test info reports correct backends and name
    - _Requirements: 16.3, 16.6_

- [ ] 12. Integrate browser engines with strategy cascade
  - [~] 12.1 Update `selectStrategy` to handle browser engines
    - When `device.platform === "browser"` and WebGPU available with sufficient memory → select `browser-webgpu`
    - When `device.platform === "browser"` and no WebGPU or insufficient memory → select `browser-wasm`
    - _Requirements: 17.1, 17.2, 17.3, 20.1, 20.2_

  - [~] 12.2 Update `LocAI` runtime to instantiate browser engines
    - When strategy selects `browser-webgpu` or `browser-wasm`, instantiate corresponding engine
    - Remove "not reachable in Node" throw for browser strategies
    - _Requirements: 20.3_

  - [~] 12.3 Wire `@locai/browser` public exports
    - Export `WasmEngine`, `WebGPUEngine`, `ModelCache` from `packages/browser/src/index.ts`
    - Ensure tree-shakeability: Node imports don't pull in browser deps
    - _Requirements: 20.4, 20.5_

  - [~] 12.4 Write integration tests for strategy cascade with browser engines
    - Test WebGPU selection when adapter available
    - Test WASM fallback when WebGPU unavailable
    - Test WASM fallback when GPU memory insufficient
    - _Requirements: 17.1, 17.2, 17.3_

- [~] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement Dashboard Agent Tab
  - [~] 14.1 Implement `useAgent` hook
    - SSE connection to `/locai/agent/run`
    - Parse SSE events into typed state
    - Expose `run()`, `stop()`, `approve()`, `reject()`, `approveAll()` methods
    - Track `isRunning`, `events`, `pendingApprovals` state
    - Implement retry with exponential backoff on API failure
    - _Requirements: 11.3, 11.4, 11.5, 12.3, 12.4, 12.5_

  - [~] 14.2 Implement `AgentTab` container and `TaskInput` component
    - Add "Agent" tab to sidebar navigation
    - Text input for task description + "Run" button
    - "Stop" button visible only while task is running
    - _Requirements: 11.1, 11.2, 11.5_

  - [~] 14.3 Implement `AgentLog` component
    - Real-time event log showing tool calls, results, and tokens as they stream
    - Collapsible tool call display with arguments
    - _Requirements: 11.4_

  - [~] 14.4 Implement `ApprovalCard` component
    - Display pending approval with tool name and arguments
    - "Approve", "Reject", "Approve All" buttons
    - Visual queue for multiple pending approvals
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [~] 14.5 Implement `DiffViewer` component
    - Side-by-side or unified diff view for file_write approvals
    - Syntax highlighting based on file extension
    - Green for additions, red for removals
    - Show entire content as additions for new files
    - Display file path prominently above diff
    - Block "Approve" button until diff is rendered
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [~] 14.6 Implement progress bar for browser engine loading
    - Display progress bar with phase label during model download/load
    - Show percentage and phase ("Downloading model..." / "Loading model...")
    - _Requirements: 19.3_

  - [~] 14.7 Write unit tests for Dashboard Agent Tab
    - Test useAgent hook state transitions
    - Test approval flow UI interactions
    - _Requirements: 11.3, 12.3, 12.4_

- [ ] 15. Final integration and wiring
  - [~] 15.1 Wire CLI to server agent endpoints
    - CLI uses `POST /locai/agent/run` with SSE for the agentic loop
    - CLI sends approval responses via `POST /locai/agent/approve`
    - CLI sends stop via `POST /locai/agent/stop` on Ctrl+C during tool execution
    - _Requirements: 1.1, 23.1, 23.4, 23.5_

  - [~] 15.2 End-to-end integration: CLI → Server → Agent loop
    - Verify full flow: user types task → server runs loop → tools execute → permission prompts → final answer
    - Ensure session persistence works across CLI restarts
    - _Requirements: 1.1, 1.4, 6.1, 6.2_

  - [~] 15.3 Write integration tests for full agent flow
    - Test CLI → server → agentic loop → tool execution → response
    - Test Dashboard → server → approval flow → resume
    - _Requirements: 23.1, 23.3, 23.4_

- [~] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design has no Correctness Properties section, so property-based tests are not included
- Unit tests validate specific examples and edge cases
- Browser engine tests may require mocking `navigator.gpu` and OPFS APIs
- The CLI uses Node.js built-in `readline` and `node:child_process` — no external deps needed
- The Agent SDK has zero runtime dependencies beyond `@locai/core` (uses Node's `EventEmitter` and `fetch`)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "5.2", "5.3", "5.4", "9.2", "9.3"] },
    { "id": 2, "tasks": ["2.2", "3.2", "5.5", "6.1", "6.2", "9.1"] },
    { "id": 3, "tasks": ["2.3", "3.3", "3.4", "5.6", "6.3", "6.4", "6.5", "6.6", "10.1"] },
    { "id": 4, "tasks": ["2.4", "3.5", "7.1", "7.2", "7.3", "10.2", "10.3", "11.1"] },
    { "id": 5, "tasks": ["7.4", "7.5", "11.2", "11.3", "11.4", "12.1"] },
    { "id": 6, "tasks": ["12.2", "12.3", "12.4", "14.1"] },
    { "id": 7, "tasks": ["14.2", "14.3", "14.4", "14.5", "14.6"] },
    { "id": 8, "tasks": ["14.7", "15.1"] },
    { "id": 9, "tasks": ["15.2", "15.3"] }
  ]
}
```
