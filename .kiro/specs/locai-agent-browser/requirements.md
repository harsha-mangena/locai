# Requirements Document

## Introduction

This spec covers two major capabilities that extend LocAI into an agentic coding tool and bring inference to the browser:

1. **`lai` CLI + `@locai/agent` SDK + Dashboard Agent Tab** — A fully local, fully private agentic coding tool. The CLI (`lai`) is a terminal-native coding assistant powered by local LLMs. The SDK (`@locai/agent`) exposes the agentic loop as a composable library for embedding in other apps. The Dashboard gains an "Agent" tab for submitting tasks, viewing tool calls, and approving/rejecting actions from the web UI.

2. **Browser Inference Engines** — Two new `InferenceEngine` implementations for the browser execution strategy tiers: a WASM engine (wllama) as the universal fallback, and a WebGPU engine (LlamaWeb/WebLLM) as the primary GPU-accelerated path. Both plug into the existing strategy cascade at Tier 4 (browser-webgpu) and Tier 5 (browser-wasm).

The competitive positioning: Claude Code costs $20/month and sends code to Anthropic. Aider requires API keys. `lai` is free, fully offline, fully private, and runs on the user's hardware with their models.

---

## Glossary

- **LAI_CLI**: The `lai` command-line binary — a terminal-native agentic coding tool that connects to the running LocAI server or spawns one automatically.
- **Agent_SDK**: The `@locai/agent` npm package — a programmatic TypeScript API for running agentic tasks, registering custom tools, and receiving progress events.
- **Agent_Tab**: The "Agent" tab in the Dashboard that provides a web UI for submitting agentic tasks, viewing tool calls, and approving/rejecting destructive actions.
- **Agentic_Loop**: The existing `runAgenticLoop` async generator in `packages/core/src/server/agentic.ts` that drives the model through tool calls until a final answer.
- **Tool_Registry**: The existing `ToolRegistry` class in `packages/core/src/tools/registry.ts` that stores tool definitions.
- **Coding_Tools**: The set of built-in tools for agentic coding: `file_read`, `file_write`, `shell_exec`, `grep_search`, `git_status`, `git_diff`, `web_fetch`.
- **Permission_System**: The mechanism that requires user approval before executing destructive operations (file writes, shell commands, git operations).
- **Session**: A persistent conversation context for the LAI_CLI, stored on disk, that can be resumed across terminal sessions.
- **Project_Context**: Automatically gathered metadata about the user's project (language, framework, package manager, .gitignore patterns) used to inform the system prompt.
- **WASM_Engine**: The browser inference engine implementation using @wllama/wllama for CPU-based WASM inference.
- **WebGPU_Engine**: The browser inference engine implementation using WebGPU for GPU-accelerated inference.
- **OPFS**: Origin Private File System — browser-native storage used to cache GGUF model files for the browser engines.
- **InferenceEngine**: The existing interface in `packages/core/src/engine/index.ts` that all engines implement (load, generate, unload).
- **Strategy_Cascade**: The existing `selectStrategy` function in `packages/core/src/planner/strategy.ts` that picks the best execution strategy for the current device.
- **Quality_Warning**: A notification shown when the active model is too small for reliable tool-use (below a capability threshold).

---

## Requirements

### Requirement 1: LAI CLI — Zero-Config Startup

**User Story:** As a developer, I want to type `lai` in my terminal and immediately start an agentic coding session without any configuration, so that I can get help with my codebase instantly.

#### Acceptance Criteria

1. WHEN the user runs `lai` with no arguments, THE LAI_CLI SHALL connect to the LocAI server at `http://localhost:8080` and start an interactive REPL session.
2. WHEN the LocAI server is not running, THE LAI_CLI SHALL attempt to start it automatically using the `serve` command from `packages/core`, and SHALL display a message indicating the server is starting.
3. IF the LocAI server cannot be started after 15 seconds, THEN THE LAI_CLI SHALL display an error message with instructions for manual server startup.
4. WHEN the user runs `lai "task description"`, THE LAI_CLI SHALL execute the described task and then return to the interactive REPL, allowing the user to continue the session or exit manually.
5. THE LAI_CLI SHALL detect the current working directory and use it as the project root for all file operations.
6. THE LAI_CLI SHALL be installable as a global npm binary via `npm install -g @locai/cli` and SHALL also be runnable via `npx @locai/cli`.

---

### Requirement 2: LAI CLI — Project Context Awareness

**User Story:** As a developer, I want `lai` to automatically understand my project's structure and conventions, so that it generates code that fits my codebase without me explaining the setup.

#### Acceptance Criteria

1. WHEN a session starts, THE LAI_CLI SHALL scan the project root for context files: `package.json`, `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `.gitignore`, `Makefile`, and `README.md`.
2. WHEN context files are found, THE LAI_CLI SHALL extract project metadata (language, framework, package manager, test runner, build tool) and include a summary in the system prompt.
3. THE LAI_CLI SHALL respect `.gitignore` patterns when performing file searches and directory listings.
4. THE LAI_CLI SHALL limit the total context gathered to 4096 tokens to avoid consuming excessive model context window.
5. WHEN a `.lai.json` or `.lai.yaml` configuration file exists in the project root, THE LAI_CLI SHALL load persona, tool permissions, and custom instructions from it.
6. WHEN no `.lai.json` or `.lai.yaml` configuration file exists, THE LAI_CLI SHALL use sensible defaults: persona set to "general coding assistant", tool permissions requiring user approval for file writes and shell commands, and no custom instructions.

---

### Requirement 3: LAI CLI — Coding Tool System

**User Story:** As a developer, I want `lai` to read files, write files, run shell commands, and search my codebase, so that it can make real changes to my project autonomously.

#### Acceptance Criteria

1. THE LAI_CLI SHALL register the following Coding_Tools in the Tool_Registry: `file_read`, `file_write`, `shell_exec`, `grep_search`, `git_status`, `git_diff`, and `web_fetch`.
2. WHEN the model calls `file_read` with a `path` parameter, THE `file_read` tool SHALL return the file contents as a string, or a structured error if the file does not exist or is not readable.
3. WHEN the model calls `file_write` with `path` and `content` parameters, THE `file_write` tool SHALL write the content to the specified path, creating parent directories as needed.
4. WHEN the model calls `shell_exec` with a `command` parameter, THE `shell_exec` tool SHALL execute the command in the project root directory and return stdout, stderr, and the exit code.
5. WHEN the model calls `grep_search` with `pattern` and optional `path` and `include` parameters, THE `grep_search` tool SHALL search files matching the pattern and return matching lines with file paths and line numbers.
6. WHEN the model calls `git_status`, THE `git_status` tool SHALL return the current git status including staged, unstaged, and untracked files.
7. WHEN the model calls `git_diff` with an optional `path` parameter, THE `git_diff` tool SHALL return the unified diff of uncommitted changes.
8. WHEN the model calls `web_fetch` with a `url` parameter, THE `web_fetch` tool SHALL fetch the URL content and return the response body truncated to 8192 characters.
9. THE `shell_exec` tool SHALL enforce a 30-second timeout per command execution; IF the timeout is exceeded, THEN THE tool SHALL kill the process and return a timeout error.
10. WHEN the model calls `file_read` on a file larger than 100KB, THE `file_read` tool SHALL return a structured error containing both a general read-error indicator and a specific size-exceeded error with the file size, and SHALL include a suggestion to read a specific line range instead.

---

### Requirement 4: LAI CLI — Permission System

**User Story:** As a developer, I want `lai` to ask for my approval before writing files or running shell commands, so that I maintain control over destructive operations.

#### Acceptance Criteria

1. WHEN the model calls `file_write`, THE LAI_CLI SHALL display the target path and a unified diff of the proposed changes, and SHALL prompt the user for approval before executing.
2. WHEN the model calls `shell_exec`, THE LAI_CLI SHALL display the command to be executed and SHALL prompt the user for approval before executing.
3. WHEN the user responds with "y" or "yes" to a permission prompt, THE LAI_CLI SHALL execute the pending operation.
4. WHEN the user responds with "n" or "no" to a permission prompt, THE LAI_CLI SHALL skip the operation and feed a "user denied this action" result back to the model.
5. WHEN the user responds with "a" or "always" to a permission prompt, THE LAI_CLI SHALL execute the operation and auto-approve all subsequent operations of the same type for the remainder of the session.
6. THE `file_read`, `grep_search`, `git_status`, `git_diff`, and `web_fetch` tools SHALL NOT require permission prompts as they are read-only operations.
7. WHEN the `.lai.json` configuration specifies `"autoApprove": ["file_write", "shell_exec"]`, THE LAI_CLI SHALL skip permission prompts for those tools.

---

### Requirement 5: LAI CLI — Streaming Output and Thinking Traces

**User Story:** As a developer, I want to see the model's output stream in real time with visible thinking traces, so that I can follow its reasoning and interrupt if it goes off track.

#### Acceptance Criteria

1. WHEN the model generates tokens, THE LAI_CLI SHALL stream them to stdout in real time with no buffering delay.
2. WHEN the model emits a `<think>` block (reasoning models), THE LAI_CLI SHALL render the thinking trace in a dimmed/gray color, visually distinct from the final answer.
3. WHEN a tool call is executed, THE LAI_CLI SHALL display the tool name and a one-line summary of the arguments in a distinct color before showing the result.
4. WHEN the user presses Ctrl+C during generation after tokens have been produced, THE LAI_CLI SHALL abort the current generation, display the partial response, and return to the input prompt without displaying token count or generation speed.
5. WHEN the user presses Ctrl+C during generation before any tokens have been produced, THE LAI_CLI SHALL abort the current generation and return directly to the input prompt without displaying any partial response.
6. THE LAI_CLI SHALL display a token count and generation speed (tok/s) only after complete (non-interrupted) responses.

---

### Requirement 6: LAI CLI — Session Persistence

**User Story:** As a developer, I want to resume a previous coding session with full conversation history, so that I can continue a multi-step task across terminal sessions.

#### Acceptance Criteria

1. WHEN a session ends (user types "exit" or presses Ctrl+D), THE LAI_CLI SHALL persist the conversation history to `~/.locai/sessions/{session_id}.json`.
2. WHEN the user runs `lai --resume`, THE LAI_CLI SHALL load the most recent session and continue the conversation from where it left off.
3. WHEN the user runs `lai --resume {session_id}`, THE LAI_CLI SHALL load the specified session by ID.
4. WHEN the user runs `lai --sessions`, THE LAI_CLI SHALL list all saved sessions with their creation date, last message preview, and project path.
5. THE LAI_CLI SHALL automatically generate a session ID based on the project name and a timestamp.
6. WHEN a session's conversation history exceeds 32768 tokens, THE LAI_CLI SHALL summarize older messages to fit within the model's context window while preserving the most recent 10 messages verbatim.

---

### Requirement 7: LAI CLI — Quality Warnings

**User Story:** As a developer, I want to be warned when the active model may not be reliable for tool-use, so that I can adjust my expectations or switch to a more capable model.

#### Acceptance Criteria

1. WHEN the active model has a `baseCapability` below 0.70, THE LAI_CLI SHALL display a warning at session start indicating the model may produce unreliable tool calls.
2. THE Quality_Warning SHALL include the model name, its capability score, and a suggestion to use a model with capability 0.70 or higher for agentic coding.
3. WHEN the model produces a malformed tool call (unparseable JSON arguments), THE LAI_CLI SHALL immediately display a warning indicating the malformed call, and SHALL retry the model call once before reporting failure.
4. THE LAI_CLI SHALL track the tool-call success rate during a session; WHEN the success rate drops below 50% after 4 or more tool calls, THE LAI_CLI SHALL display a persistent warning suggesting a more capable model.

---

### Requirement 8: Agent SDK — Programmatic API

**User Story:** As a developer building apps on top of LocAI, I want a TypeScript SDK that lets me run agentic tasks programmatically, so that I can embed agentic capabilities in my own applications.

#### Acceptance Criteria

1. THE Agent_SDK SHALL export an `AgentRunner` class that accepts a configuration object with: `serverUrl` (string, default "http://localhost:8080"), `tools` (optional array of custom ToolDefinitions), and `maxIterations` (number, default 10).
2. WHEN `AgentRunner.run(task: string, options?: RunOptions)` is called, THE Agent_SDK SHALL execute the agentic loop against the LocAI server and return a `RunResult` containing the final answer, tool call history, and token usage.
3. THE Agent_SDK SHALL emit typed events during execution: `tool_call`, `tool_result`, `token`, `thinking`, `error`, and `done`.
4. THE Agent_SDK SHALL allow registering custom tools via `AgentRunner.registerTool(definition: ToolDefinition)` that are merged with the built-in Coding_Tools.
5. THE Agent_SDK SHALL support cancellation via an `AbortSignal` passed in `RunOptions`.
6. THE Agent_SDK SHALL be published as `@locai/agent` and SHALL have zero runtime dependencies beyond `@locai/core`.

---

### Requirement 9: Agent SDK — Custom Tool Registration

**User Story:** As a developer, I want to register my own tools with the agent SDK, so that the model can interact with my application's specific APIs and data sources.

#### Acceptance Criteria

1. WHEN a custom tool is registered via `AgentRunner.registerTool()`, THE Agent_SDK SHALL include it in the tools array sent to the model alongside built-in tools.
2. THE custom tool definition SHALL follow the existing `ToolDefinition` interface: `name`, `description`, `parameters` (JSON Schema), and `execute` (async function).
3. IF a custom tool is registered with a name that conflicts with a built-in tool or a previously registered custom tool, THEN THE Agent_SDK SHALL throw an error at registration time.
4. THE Agent_SDK SHALL validate that the custom tool's `parameters` field is a valid JSON Schema object at registration time; IF validation fails, THEN THE Agent_SDK SHALL throw a descriptive error.
5. WHEN the model calls a custom tool, THE Agent_SDK SHALL execute it through the same Tool_Executor pipeline as built-in tools, including error handling and timeout enforcement.

---

### Requirement 10: Agent SDK — Event-Based Progress Reporting

**User Story:** As a developer embedding the agent in my app, I want real-time events for every step of the agentic loop, so that I can build responsive UIs that show what the agent is doing.

#### Acceptance Criteria

1. THE Agent_SDK SHALL emit a `tool_call` event with `{ id, name, arguments }` before each tool execution.
2. THE Agent_SDK SHALL emit a `tool_result` event with `{ id, name, result }` after each tool execution completes.
3. THE Agent_SDK SHALL emit `token` events with `{ content, stop }` for each streamed token from the model.
4. THE Agent_SDK SHALL emit a `thinking` event with `{ content }` for tokens inside a `<think>` block.
5. THE Agent_SDK SHALL emit an `error` event with `{ message, recoverable }` when a tool fails or the model produces invalid output.
6. THE Agent_SDK SHALL emit a `done` event with `{ finalAnswer, iterations, tokenCount }` when the agentic loop completes, where `iterations` SHALL be at least 1 representing at least one model interaction.
7. FOR ALL agentic loop executions, THE sequence of events emitted SHALL be reconstructible into the complete conversation history (round-trip property).

---

### Requirement 11: Dashboard Agent Tab — Task Submission

**User Story:** As a user, I want to submit agentic coding tasks from the dashboard web UI, so that I can use the agent without a terminal.

#### Acceptance Criteria

1. THE Dashboard SHALL include an "Agent" tab accessible from the main navigation sidebar.
2. THE Agent_Tab SHALL provide a text input for describing the task and a "Run" button to submit it.
3. WHEN the user submits a task, THE Agent_Tab SHALL call the LocAI server's agentic endpoint with the task description and the registered Coding_Tools; IF the API call fails, THEN THE Agent_Tab SHALL automatically retry with exponential backoff and display a progress indicator to the user.
4. WHEN a task is running, THE Agent_Tab SHALL display a real-time log of tool calls, tool results, and model tokens as they stream in via SSE.
5. WHILE a task is actively executing, THE Agent_Tab SHALL display a "Stop" button; WHEN the task is idle or complete, THE Agent_Tab SHALL hide the "Stop" button.

---

### Requirement 12: Dashboard Agent Tab — Action Approval

**User Story:** As a user, I want to approve or reject destructive actions (file writes, shell commands) from the dashboard before they execute, so that I maintain control over what the agent does to my codebase.

#### Acceptance Criteria

1. WHEN the agent requests a `file_write` operation, THE Agent_Tab SHALL display the target path and a syntax-highlighted diff of the proposed changes, and SHALL pause execution until the user approves or rejects.
2. WHEN the agent requests a `shell_exec` operation, THE Agent_Tab SHALL display the command and SHALL pause execution until the user approves or rejects.
3. WHEN the user clicks "Approve", THE Agent_Tab SHALL resume execution with the approved action.
4. WHEN the user clicks "Reject", THE Agent_Tab SHALL feed a denial result back to the model and continue the agentic loop.
5. WHEN the user clicks "Approve All", THE Agent_Tab SHALL auto-approve all subsequent actions for the current task.
6. THE Agent_Tab SHALL display a visual queue of pending approvals when multiple actions are requested in sequence.

---

### Requirement 13: Dashboard Agent Tab — File Diff Viewer

**User Story:** As a user, I want to see a clear visual diff of file changes before approving them, so that I can understand exactly what the agent wants to modify.

#### Acceptance Criteria

1. WHEN a `file_write` action is pending approval, THE Agent_Tab SHALL display a side-by-side or unified diff view showing the original file content and the proposed new content; THE Agent_Tab SHALL block the "Approve" button until the diff is successfully rendered.
2. THE diff viewer SHALL use syntax highlighting appropriate to the file type (detected from the file extension).
3. THE diff viewer SHALL highlight added lines in green and removed lines in red.
4. WHEN the target file does not exist (new file creation), THE diff viewer SHALL display the entire proposed content as additions.
5. THE diff viewer SHALL display the file path prominently above the diff content.

---

### Requirement 14: WASM Engine — InferenceEngine Implementation

**User Story:** As a user accessing LocAI from a browser on any device, I want inference to work via WASM as a universal fallback, so that I can use LocAI even without WebGPU support.

#### Acceptance Criteria

1. THE WASM_Engine SHALL implement the existing `InferenceEngine` interface with `info`, `supports`, `load`, `generate`, and `unload` methods.
2. THE WASM_Engine SHALL use the `@wllama/wllama` npm package for WASM-based GGUF model inference.
3. WHEN `load` is called, THE WASM_Engine SHALL load the GGUF model file from OPFS cache; IF the model is not cached, THE WASM_Engine SHALL download it and store it in OPFS before loading.
4. WHEN `generate` is called with no model loaded, THE WASM_Engine SHALL return an error immediately indicating no model is loaded, without attempting to stream tokens.
5. WHEN `generate` is called with a model loaded, THE WASM_Engine SHALL stream tokens via the async iterable interface, yielding `GenerateChunk` objects with `token`, `index`, and `done` fields.
6. THE WASM_Engine SHALL report `info.backends` as `["wasm"]` and `info.name` as `"wllama"`.
7. THE WASM_Engine SHALL support the `GenerateParams` fields: `prompt`, `maxTokens`, `temperature`, `topP`, `topK`, `stop`.
8. WHEN `unload` is called, THE WASM_Engine SHALL free all WASM memory and release the model from memory; THE WASM_Engine SHALL verify complete WASM memory cleanup and SHALL report failure if memory persists after the cleanup attempt.

---

### Requirement 15: WASM Engine — Model Download and OPFS Caching

**User Story:** As a user, I want models to be downloaded once and cached in browser storage, so that subsequent visits load instantly without re-downloading.

#### Acceptance Criteria

1. WHEN a model is not present in OPFS, THE WASM_Engine SHALL download it from the configured URL with progress reporting.
2. THE WASM_Engine SHALL emit progress events during download with `{ bytesLoaded, bytesTotal, fraction }` so the UI can display a progress bar.
3. WHEN a model download completes, THE WASM_Engine SHALL store the GGUF file in OPFS under a path derived from the model ID and quant ID, regardless of the current loading mode (including when using in-memory fallback).
4. WHEN a model is already cached in OPFS, THE WASM_Engine SHALL load it directly without network requests.
5. THE WASM_Engine SHALL expose a `getCachedModels()` method that returns the list of models currently stored in OPFS with their sizes.
6. THE WASM_Engine SHALL expose a `deleteModel(modelId, quantId)` method that removes a cached model from OPFS.
7. IF OPFS is unavailable (older browsers), THEN THE WASM_Engine SHALL fall back to in-memory loading with a warning that the model will need to be re-downloaded on next visit.
8. WHEN OPFS write operations become unavailable during a session but a model is already cached in OPFS, THE WASM_Engine SHALL load from the existing OPFS cache and display a warning that future caching will not work.

---

### Requirement 16: WebGPU Engine — InferenceEngine Implementation

**User Story:** As a user with a WebGPU-capable browser, I want GPU-accelerated inference that is significantly faster than WASM, so that I get a responsive experience comparable to native inference.

#### Acceptance Criteria

1. THE WebGPU_Engine SHALL implement the existing `InferenceEngine` interface with `info`, `supports`, `load`, `generate`, and `unload` methods.
2. THE WebGPU_Engine SHALL use WebGPU APIs for GPU-accelerated inference of GGUF models.
3. WHEN `supports` is called, THE WebGPU_Engine SHALL return `true` whenever both `navigator.gpu` is available and a GPU adapter can be obtained, regardless of other factors.
4. WHEN `load` is called, THE WebGPU_Engine SHALL load the model from OPFS cache (shared with the WASM_Engine) and initialize WebGPU compute pipelines.
5. WHEN `generate` is called, THE WebGPU_Engine SHALL stream tokens via the async iterable interface, yielding `GenerateChunk` objects.
6. THE WebGPU_Engine SHALL report `info.backends` as `["webgpu"]` and `info.name` as `"webgpu-llama"`.
7. THE WebGPU_Engine SHALL support the same `GenerateParams` fields as the WASM_Engine: `prompt`, `maxTokens`, `temperature`, `topP`, `topK`, `stop`.
8. WHEN `unload` is called, THE WebGPU_Engine SHALL release all GPU buffers and destroy the WebGPU device.

---

### Requirement 17: WebGPU Engine — Capability Detection and Fallback

**User Story:** As a user, I want the browser to automatically use WebGPU when available and fall back to WASM when it is not, so that inference always works regardless of my browser's capabilities.

#### Acceptance Criteria

1. WHEN the browser supports WebGPU (`navigator.gpu` is defined, an adapter is obtainable, and the adapter reports sufficient memory for the requested model), THE Strategy_Cascade SHALL select `browser-webgpu` as the execution strategy.
2. WHEN the browser does not support WebGPU, THE Strategy_Cascade SHALL fall back to `browser-wasm` as the execution strategy.
3. WHEN WebGPU is available but the GPU adapter reports insufficient memory for the requested model, THE Strategy_Cascade SHALL fall back to `browser-wasm`.
4. THE WebGPU_Engine SHALL probe GPU adapter limits (maxBufferSize, maxStorageBufferBindingSize) during `supports()` to determine if the model fits in GPU memory.
5. WHEN a WebGPU operation fails at runtime (device lost, out-of-memory), THE WebGPU_Engine SHALL emit an error event and THE Strategy_Cascade SHALL automatically fall back to the WASM_Engine for the remainder of the session.

---

### Requirement 18: Browser Engines — Shared OPFS Model Cache

**User Story:** As a user, I want both the WASM and WebGPU engines to share the same cached model files, so that switching between engines does not require re-downloading.

#### Acceptance Criteria

1. THE WASM_Engine and WebGPU_Engine SHALL use the same OPFS directory structure for cached model files.
2. THE OPFS cache path for a model SHALL be derived deterministically from the model ID and quant ID: `/models/{modelId}/{quantId}.gguf`.
3. WHEN a model is downloaded by either engine, THE other engine SHALL be able to load it from the same OPFS path without re-downloading; IF the cached file is unloadable (corrupted or incompatible), THEN THE engine SHALL re-download the model and replace the cached file.
4. THE browser engines SHALL expose a shared `ModelCache` class that both engines use for download, storage, and retrieval operations.
5. THE `ModelCache` SHALL track download state so that concurrent requests for the same model do not trigger duplicate downloads.

---

### Requirement 19: Browser Engines — Progress Reporting During Load

**User Story:** As a user, I want to see loading progress when a model is being prepared for inference in the browser, so that I know the system is working and can estimate wait time.

#### Acceptance Criteria

1. WHEN a model is being downloaded, THE browser engine SHALL emit progress events with `{ phase: "download", bytesLoaded, bytesTotal, fraction }`.
2. WHEN a model is being loaded into memory (WASM compilation or WebGPU pipeline creation), THE browser engine SHALL emit progress events with `{ phase: "load", fraction }`.
3. THE Dashboard SHALL display a progress bar with phase label ("Downloading model..." or "Loading model...") and percentage during browser engine initialization.
4. WHEN loading completes, THE browser engine SHALL emit a `{ phase: "ready" }` event.
5. IF a download is interrupted (network error, tab closed), THEN THE browser engine SHALL support resuming from the last downloaded byte on the next attempt using HTTP Range requests.

---

### Requirement 20: Browser Engines — Integration with Strategy Cascade

**User Story:** As a developer, I want the browser engines to plug into the existing strategy cascade seamlessly, so that the planner can select them automatically based on device capabilities.

#### Acceptance Criteria

1. THE WASM_Engine SHALL be selectable by the Strategy_Cascade when `device.platform` is `"browser"` and no WebGPU adapter is available.
2. THE WebGPU_Engine SHALL be selectable by the Strategy_Cascade when `device.platform` is `"browser"` and a WebGPU adapter is available with sufficient memory.
3. WHEN the Strategy_Cascade selects `browser-webgpu` or `browser-wasm`, THE `LocAI` runtime SHALL instantiate the corresponding browser engine instead of throwing "not reachable in Node".
4. THE browser engines SHALL be tree-shakeable: importing `@locai/core` in a Node environment SHALL NOT bundle wllama or WebGPU dependencies.
5. THE browser engines SHALL be importable via a separate entry point: `@locai/core/browser` or `@locai/browser`.

---

### Requirement 21: LAI CLI — Adaptive Model Usage

**User Story:** As a developer, I want `lai` to work with whatever model the planner picks for my device, so that I get the best possible agentic experience without manual model selection.

#### Acceptance Criteria

1. THE LAI_CLI SHALL use the model selected by the Strategy_Cascade without requiring the user to specify a model.
2. WHEN the user runs `lai --model {model_id}`, THE LAI_CLI SHALL override the planner and use the specified model if it is available locally.
3. THE LAI_CLI SHALL include the model name and capability score in the session startup banner.
4. WHEN the active model changes due to a background download completing (strategy upgrade), THE LAI_CLI SHALL first notify the user about the model change, and only after successful notification SHALL offer to restart the session with the new model.
5. THE LAI_CLI SHALL construct tool descriptions that fit within the model's context window, truncating tool parameter descriptions if the total tool schema exceeds 2048 tokens.

---

### Requirement 22: LAI CLI — System Prompt and Persona

**User Story:** As a developer, I want `lai` to behave like a knowledgeable coding assistant with awareness of my project, so that its responses are contextually relevant and actionable.

#### Acceptance Criteria

1. THE LAI_CLI SHALL construct a system prompt that includes: the assistant's role (expert coding assistant), the project context summary, available tool descriptions, and behavioral guidelines (be concise, show code, explain changes).
2. WHEN a `.lai.json` file specifies a `persona` field, THE LAI_CLI SHALL prepend the persona instructions to the system prompt.
3. THE system prompt SHALL instruct the model to use tools proactively (read files before editing, check git status before committing) rather than guessing.
4. THE system prompt SHALL instruct the model to explain what it is about to do before executing destructive operations.
5. THE LAI_CLI SHALL keep the total system prompt between 256 tokens (minimum, to ensure essential components like role and guidelines are always present) and 1024 tokens (maximum, to preserve context window for conversation and tool results).

---

### Requirement 23: Agentic Server Endpoint for Dashboard

**User Story:** As a developer, I want the LocAI server to expose an agentic endpoint that the Dashboard Agent Tab can call, so that agentic tasks can be run from the web UI with approval flow support.

#### Acceptance Criteria

1. THE LocAI_Server SHALL expose `POST /locai/agent/run` that accepts `{ task: string, tools?: string[], autoApprove?: boolean }` and returns an SSE stream of agentic events.
2. THE SSE stream SHALL emit events of types: `tool_call`, `tool_result`, `token`, `thinking`, `approval_required`, `done`, and `error`.
3. WHEN `autoApprove` is false and a destructive or sensitive tool is called, THE server SHALL emit an `approval_required` event and halt all execution including token generation and thinking until a follow-up request approves or rejects the action. Sensitive non-destructive operations (such as reading sensitive files) SHALL also require approval when configured.
4. THE LocAI_Server SHALL expose `POST /locai/agent/approve` accepting `{ taskId: string, actionId: string, approved: boolean }` to resolve pending approval requests.
5. THE LocAI_Server SHALL expose `POST /locai/agent/stop` accepting `{ taskId: string }` to abort a running agentic task.
6. WHEN a task completes, THE server SHALL emit a `done` event with `{ finalAnswer, iterations, toolCalls }` and close the SSE stream.
