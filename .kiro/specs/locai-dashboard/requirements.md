# Requirements Document

## Introduction

This spec covers three tightly interconnected features that together form the LocAI user-facing product layer:

1. **Web Dashboard** (`packages/dashboard`) — a React 19 + Vite + Tailwind CSS v4 + shadcn/ui single-page application that is the primary UI for LocAI. It connects to the existing OpenAI-compatible server at `localhost:8080`, exposes the auto-plan rationale (LocAI's core moat), and provides a chat interface with streaming, model management, device profiling, and settings.

2. **Tool Use / Function Calling** (`packages/core`) — extends the existing OpenAI-compatible server to support the `tools` parameter in `/v1/chat/completions`, implements a tool registry, a tool executor, and an agentic loop that drives the model until it stops calling tools.

3. **Web Search Tool + Reasoning Model Support** (`packages/core` + `packages/dashboard`) — a concrete `web_search` tool backed by SearXNG or DuckDuckGo, plus first-class support for reasoning models (DeepSeek-R1, Qwen3, QwQ) including `<think>…</think>` stream parsing, a collapsible reasoning trace panel in the dashboard, and reasoning model entries in the seed catalog.

The dashboard talks directly to the existing LocAI server — no new backend is introduced. Tool execution runs inside the existing Node server (`packages/core/src/server/openai.ts`). All code is TypeScript in the existing monorepo workspace.

---

## Glossary

- **Dashboard**: The React 19 web application in `packages/dashboard`.
- **LocAI_Server**: The existing OpenAI-compatible HTTP server in `packages/core/src/server/openai.ts`, running on `localhost:8080` by default.
- **Auto_Plan**: The output of the LocAI planner — the chosen model, quant, backend, predicted tok/s, memory pressure, and fit class, plus a human-readable rationale array.
- **Why_Panel**: The dashboard panel that surfaces the Auto_Plan rationale to the user.
- **Model_Hub**: The `ModelHub` class in `packages/core/src/catalog/hub.ts` that manages model discovery, download, and eviction.
- **Tool_Registry**: A map of tool name → `ToolDefinition` (JSON Schema descriptor + executor function) maintained in `packages/core`.
- **Tool_Executor**: The component that receives a `tool_call` from the model and dispatches it to the correct registered tool.
- **Agentic_Loop**: The server-side loop that calls the model, executes any tool calls, feeds results back, and repeats until the model emits a final answer with no pending tool calls.
- **Reasoning_Model**: A model that emits a `<think>…</think>` block before its final answer (DeepSeek-R1, Qwen3, QwQ, Phi-4-reasoning).
- **Thinking_Trace**: The content inside `<think>…</think>` emitted by a Reasoning_Model.
- **Reasoning_Panel**: The collapsible dashboard UI component that displays the Thinking_Trace separately from the final answer.
- **Web_Search_Tool**: The concrete tool named `web_search` that queries SearXNG or DuckDuckGo and returns structured results.
- **Search_Backend**: The HTTP search provider used by the Web_Search_Tool — either a self-hosted SearXNG instance or the DuckDuckGo Instant Answers API.
- **Citation**: A source reference (title + URL + snippet) returned by the Web_Search_Tool and rendered in the dashboard alongside the model's synthesized answer.
- **SSE**: Server-Sent Events — the streaming protocol used by `/v1/chat/completions` with `stream: true`.
- **TanStack_Query**: The React data-fetching library used in the Dashboard for server state management.
- **Conversation_History**: Per-conversation message arrays persisted to `localStorage` in the Dashboard.
- **Device_Profile_Panel**: The dashboard panel that displays the `DeviceProfile` returned by the LocAI server.
- **Model_Hub_Panel**: The dashboard panel that shows downloaded models, available models, and download progress.
- **Settings_Panel**: The dashboard panel for user-configurable inference parameters (goal, max tokens, temperature, context length).

---

## Requirements

### Requirement 1: Dashboard Package Setup

**User Story:** As a developer, I want a `packages/dashboard` workspace package with the correct toolchain configured, so that the dashboard can be built, developed, and served as part of the monorepo.

#### Acceptance Criteria

1. THE Dashboard SHALL be a Vite + React 19 + TypeScript project located at `packages/dashboard` in the monorepo workspace.
2. THE Dashboard SHALL use Tailwind CSS v4 and shadcn/ui as its component and styling system.
3. THE Dashboard SHALL use TanStack Query v5 for all server-state data fetching and caching.
4. WHEN `npm run dev` is executed in `packages/dashboard`, THE Dashboard SHALL start a local development server on port 5173, or automatically select an available port if 5173 is already in use.
5. WHEN `npm run build` is executed in `packages/dashboard`, THE Dashboard SHALL produce a production-ready static bundle in `packages/dashboard/dist`.
6. THE Dashboard SHALL support dark mode and light mode, with the user's OS preference applied as the default.

---

### Requirement 2: LocAI Server Connection and Health

**User Story:** As a user, I want the dashboard to connect to my running LocAI server and show me its status, so that I know whether inference is available before I start chatting.

#### Acceptance Criteria

1. WHEN the Dashboard loads, THE Dashboard SHALL poll `GET /health` on the configured LocAI_Server URL (default `http://localhost:8080`) every 5 seconds.
2. WHEN the LocAI_Server actively responds with `{ status: "ok" }` on the current poll cycle, THE Dashboard SHALL display a "Connected" status indicator.
3. WHEN the LocAI_Server does not respond within 3 seconds, THE Dashboard SHALL display a "Disconnected" status indicator and surface a reconnect prompt.
4. THE Dashboard SHALL allow the user to configure the LocAI_Server base URL in the Settings_Panel, and SHALL persist this setting to `localStorage`.
5. WHEN the LocAI_Server URL is changed, THE Dashboard SHALL immediately re-attempt the health check against the new URL.

---

### Requirement 3: Why Panel (Auto-Plan Rationale)

**User Story:** As a user, I want to see exactly why LocAI chose a particular model, quant, and backend for my device, so that I can understand and trust the auto-planning decision.

#### Acceptance Criteria

1. WHEN the Dashboard connects to the LocAI_Server, THE Dashboard SHALL fetch `GET /locai/plan` and display the result in the Why_Panel.
2. THE Why_Panel SHALL display the following fields from the plan response: model display name, quant ID, backend, predicted tok/s, memory pressure percentage, and fit class.
3. THE Why_Panel SHALL display each entry in the `rationale` array as a separate line of explanatory text.
4. THE Why_Panel SHALL use a color-coded badge for fit class: green for "comfortable", yellow for "tight", orange for "thrash", red for "over-cliff".
5. WHEN the plan data is loading, THE Why_Panel SHALL display a skeleton placeholder.
6. IF the `/locai/plan` endpoint returns an error, THEN THE Why_Panel SHALL immediately replace any loading state with a descriptive error message; existing stale plan data MAY remain visible alongside the error.

---

### Requirement 4: Chat Interface with Streaming

**User Story:** As a user, I want to chat with the local model and see tokens appear in real time as they are generated, so that I get immediate feedback and the experience feels responsive.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a chat input field and a send button that submits the user's message to `POST /v1/chat/completions` on the LocAI_Server.
2. WHEN a message is submitted, THE Dashboard SHALL send the request with `stream: true` and render each SSE token chunk incrementally as it arrives.
3. WHEN the model is generating, THE Dashboard SHALL display a visual indicator (e.g., animated cursor or spinner) and disable the send button until generation completes or is cancelled.
4. THE Dashboard SHALL render assistant message content as Markdown, including syntax-highlighted code blocks.
5. WHEN the user presses Escape or clicks a stop button during active generation, THE Dashboard SHALL abort the in-flight SSE stream and display the partial response.
6. THE Dashboard SHALL pass the full Conversation_History as the `messages` array on each request, so the model has context of prior turns.
7. WHEN a new conversation is started, THE Dashboard SHALL clear the message list and begin a fresh Conversation_History.

---

### Requirement 5: Conversation History Persistence

**User Story:** As a user, I want my conversations to be saved locally so that I can return to them after closing the browser tab.

#### Acceptance Criteria

1. WHEN a message is added to a conversation, THE Dashboard SHALL persist the updated Conversation_History to `localStorage` under a key derived from the conversation ID.
2. WHEN the Dashboard loads, THE Dashboard SHALL restore all previously saved conversations from `localStorage` and display them in a sidebar list.
3. THE Dashboard SHALL allow the user to delete a conversation, which SHALL remove it from both the sidebar and `localStorage`.
4. THE Dashboard SHALL allow the user to rename a conversation, which SHALL update the stored name in `localStorage`.
5. WHEN `localStorage` is unavailable or throws, THE Dashboard SHALL both continue operating without persistence AND display a non-blocking warning; both behaviors are required.

---

### Requirement 6: Reasoning Model Support — Stream Parsing

**User Story:** As a user chatting with a reasoning model (DeepSeek-R1, Qwen3, QwQ), I want the thinking trace separated from the final answer so that I can read the model's reasoning without it cluttering the response.

#### Acceptance Criteria

1. WHEN the LocAI_Server streams tokens that include a `<think>` delimiter, THE Dashboard SHALL immediately begin routing subsequent tokens to the Thinking_Trace buffer without waiting for the closing `</think>`.
2. WHILE the stream is inside a `<think>…</think>` block, THE Dashboard SHALL route those tokens to the Reasoning_Panel rather than the main message bubble.
3. WHEN the `</think>` delimiter is received, THE Dashboard SHALL finalize the Thinking_Trace and begin rendering the final answer in the main message bubble.
4. THE Reasoning_Panel SHALL be collapsible, defaulting to collapsed, with a toggle that shows the token count of the thinking trace.
5. WHEN a model does not emit `<think>` tokens, THE Dashboard SHALL render the response normally with no Reasoning_Panel shown.
6. THE Dashboard SHALL handle the case where `<think>` spans multiple SSE chunks without corrupting the stream.

---

### Requirement 7: Reasoning Model Support — Core Parser

**User Story:** As a developer, I want a pure TypeScript stream parser in `packages/core` that separates `<think>…</think>` content from the final answer, so that both the server and the dashboard can use it reliably.

#### Acceptance Criteria

1. THE `ThinkingStreamParser` SHALL accept a stream of string tokens and emit typed events: `thinking_token`, `answer_token`, and `done`.
2. WHEN a `<think>` delimiter is encountered in the token stream, THE `ThinkingStreamParser` SHALL transition to thinking state and emit subsequent tokens as `thinking_token` events.
3. WHEN a `</think>` delimiter is encountered, THE `ThinkingStreamParser` SHALL transition to answer state and emit subsequent tokens as `answer_token` events.
4. THE `ThinkingStreamParser` SHALL handle the case where a delimiter is split across multiple tokens (e.g., `<thi` then `nk>`).
5. FOR ALL valid token streams, THE `ThinkingStreamParser` SHALL produce a concatenated thinking trace and answer that, when joined, equal the original full text (round-trip property).
6. IF a stream ends while still in thinking state (no closing `</think>`), THEN THE `ThinkingStreamParser` SHALL emit all buffered content as `answer_token` events and emit `done`.

---

### Requirement 8: Reasoning Models in Seed Catalog

**User Story:** As a user on a mobile or low-RAM device, I want reasoning models available in the catalog at sizes that fit my hardware, so that I can use chain-of-thought reasoning without needing a high-end machine.

#### Acceptance Criteria

1. THE seed catalog SHALL include `DeepSeek-R1-Distill-Qwen-1.5B` with `supportsReasoning: true`, `chatTemplate: "deepseek-r1"`, and the `reasoningQuants` ladder.
2. THE seed catalog SHALL include `QwQ-32B` with `supportsReasoning: true`, `chatTemplate: "qwen3"`, and the `reasoningQuants` ladder.
3. FOR ALL models in the seed catalog with `supportsReasoning: true`, THE model descriptor SHALL have `chatTemplate` set to a value other than `"generic"`.
4. FOR ALL models in the seed catalog with `supportsReasoning: true`, THE model descriptor SHALL have `samplingDefaults` set to the `REASONING_SAMPLING` profile (temperature ≤ 0.6, repeatPenalty = 1.0).

---

### Requirement 9: Tool Registry

**User Story:** As a developer, I want a typed tool registry in `packages/core` where I can register tools with JSON Schema descriptors, so that the model can discover and call them via the OpenAI tools API.

#### Acceptance Criteria

1. THE Tool_Registry SHALL store tool definitions as a map of `name → ToolDefinition`, where `ToolDefinition` contains a JSON Schema `parameters` object and an async `execute` function.
2. WHEN a tool is registered with a name that already exists, THE Tool_Registry SHALL throw an error to prevent silent overwrites.
3. THE Tool_Registry SHALL expose a `toOpenAITools()` method that returns the array of tool descriptors in the OpenAI `tools` format (`type: "function"`, `function: { name, description, parameters }`).
4. THE Tool_Registry SHALL expose a `get(name)` method that returns the `ToolDefinition` for a given name, or `null` if not found.
5. FOR ALL registered tools, THE `toOpenAITools()` output SHALL include the tool's name, description, and parameters schema exactly as registered.

---

### Requirement 10: Tool Executor

**User Story:** As a developer, I want a tool executor that receives a model's `tool_call` object and dispatches it to the correct registered tool, so that tool results can be fed back to the model.

#### Acceptance Criteria

1. WHEN the Tool_Executor receives a `tool_call` with a `name` that exists in the Tool_Registry, THE Tool_Executor SHALL parse the `arguments` JSON string, call the tool's `execute` function, and return the result as a string.
2. IF the `arguments` JSON string is malformed, THEN THE Tool_Executor SHALL return a structured error string describing the parse failure rather than throwing.
3. IF the tool's `execute` function throws, THEN THE Tool_Executor SHALL catch the error and return a structured error string rather than propagating the exception.
4. IF the `tool_call` names a tool not in the Tool_Registry, THEN THE Tool_Executor SHALL return a structured error string indicating the tool was not found.
5. THE Tool_Executor SHALL execute tool calls sequentially when multiple `tool_calls` are present in a single model response.

---

### Requirement 11: Agentic Loop

**User Story:** As a user, I want the model to automatically call tools and incorporate their results until it has enough information to answer my question, so that I get a complete, grounded response without manual intervention.

#### Acceptance Criteria

1. WHEN a `/v1/chat/completions` request includes a `tools` array, THE LocAI_Server SHALL pass the tools to the model and enter the Agentic_Loop.
2. WHEN the model response contains `tool_calls`, THE Agentic_Loop SHALL execute each tool call via the Tool_Executor, append the results as `tool` role messages, and call the model again.
3. WHEN the model response contains no `tool_calls`, THE Agentic_Loop SHALL treat the response as the final answer and return it to the client.
4. THE Agentic_Loop SHALL enforce a maximum of 10 iterations per request to prevent infinite loops.
5. IF the Agentic_Loop reaches the iteration limit, THEN THE LocAI_Server SHALL return the last model response with a warning appended indicating the limit was reached.
6. WHEN `stream: true` is set, THE LocAI_Server SHALL stream the final answer tokens to the client after all tool calls are resolved; intermediate tool call/result pairs SHALL be sent as non-streamed SSE events before the final answer stream begins.

---

### Requirement 12: Web Search Tool

**User Story:** As a user, I want the model to search the web when it needs current information, so that I get up-to-date, cited answers without leaving the chat.

#### Acceptance Criteria

1. THE Web_Search_Tool SHALL be registered in the Tool_Registry with the name `web_search`, accepting parameters `query` (string, required) and `num_results` (integer, optional, default 5, max 10).
2. WHEN the Web_Search_Tool is called, THE Web_Search_Tool SHALL query the configured Search_Backend and return the top `num_results` results as a JSON array of `{ title, url, snippet }` objects.
3. THE Web_Search_Tool SHALL use SearXNG as the Search_Backend when the `SEARXNG_URL` environment variable is set; WHEN `SEARXNG_URL` is not set, THE Web_Search_Tool SHALL fall back to the DuckDuckGo Instant Answers API.
4. WHEN the Search_Backend returns HTML content, THE Web_Search_Tool SHALL strip HTML tags and return plain readable text in the `snippet` field.
5. IF the Search_Backend request fails or times out after 10 seconds, THEN THE Web_Search_Tool SHALL return a structured error result rather than throwing.
6. THE Web_Search_Tool SHALL NOT be called more than 3 times per Agentic_Loop iteration to prevent runaway search loops.

---

### Requirement 13: Citations in Dashboard

**User Story:** As a user, I want to see the sources the model used when it searched the web, so that I can verify the information and read the original articles.

#### Acceptance Criteria

1. WHEN the LocAI_Server executes a `web_search` tool call, THE LocAI_Server SHALL include the search results in the SSE stream as a structured `tool_result` event before the final answer stream.
2. WHEN the Dashboard receives a `tool_result` event for `web_search`, THE Dashboard SHALL render a Citations panel below the assistant message containing the title, URL, and snippet for each result.
3. THE Citations panel SHALL render each citation as a clickable link that opens the source URL in a new browser tab.
4. WHEN no web search was performed, or when a web search was attempted but failed or returned no results, THE Dashboard SHALL not render a Citations panel for that message.
5. THE Citations panel SHALL be collapsible, defaulting to expanded for the most recent message and collapsed for older messages.

---

### Requirement 14: Tool Calls Visibility in Dashboard

**User Story:** As a user, I want to see which tools the model called and what results it got, so that I can understand how the model arrived at its answer.

#### Acceptance Criteria

1. WHEN the Dashboard receives a `tool_call` SSE event, THE Dashboard SHALL display a tool-call indicator in the message thread showing the tool name and a summary of the arguments.
2. WHEN the Dashboard receives a `tool_result` SSE event, THE Dashboard SHALL display the result summary alongside the corresponding tool-call indicator.
3. THE tool-call and tool-result indicators SHALL be visually distinct from user and assistant message bubbles.
4. THE tool-call indicators SHALL be collapsible so the user can hide the details and see only the final answer.

---

### Requirement 15: Model Hub Panel

**User Story:** As a user, I want to see which models are downloaded, which are available to download, and the progress of any active downloads, so that I can manage my local model library from the dashboard.

#### Acceptance Criteria

1. WHEN the Dashboard loads, THE Dashboard SHALL fetch model status from a `GET /locai/models` endpoint on the LocAI_Server and display it in the Model_Hub_Panel.
2. THE Model_Hub_Panel SHALL display each model with its display name, parameter count, quant options, size on disk, and availability status ("ready", "downloading", "available", "no-space").
3. WHEN a model has `availability: "downloading"`, THE Model_Hub_Panel SHALL display a progress bar with the current download percentage and estimated time remaining.
4. WHEN the user clicks "Download" on an available model, THE Dashboard SHALL call `POST /locai/models/download` with the model ID and quant ID, and begin showing download progress.
5. WHEN the user clicks "Delete" on a downloaded model, THE Dashboard SHALL call `DELETE /locai/models/:modelId/:quantId` and remove the model from the "ready" list.
6. THE LocAI_Server SHALL expose `GET /locai/models`, `POST /locai/models/download`, and `DELETE /locai/models/:modelId/:quantId` endpoints backed by the existing `ModelHub`.
7. WHEN a download completes, THE Model_Hub_Panel SHALL update the model's status to "ready" without requiring a page refresh.

---

### Requirement 16: Device Profile Panel

**User Story:** As a user, I want to see my device's hardware profile as detected by LocAI, so that I understand why certain models were chosen or excluded.

#### Acceptance Criteria

1. THE LocAI_Server SHALL expose a `GET /locai/device` endpoint that returns the `DeviceProfile` for the current machine.
2. WHEN the Dashboard loads, THE Dashboard SHALL fetch `GET /locai/device` and display the result in the Device_Profile_Panel; IF the fetch fails, THE Device_Profile_Panel SHALL display a descriptive error message.
3. THE Device_Profile_Panel SHALL display: platform, CPU brand, physical core count, total RAM, usable RAM, memory bandwidth (if known), and the list of accelerators with their names and available status.
4. THE Device_Profile_Panel SHALL display a "thermally constrained" badge when `thermallyConstrained` is true.
5. WHEN the device profile data is loading, THE Device_Profile_Panel SHALL display a skeleton placeholder.

---

### Requirement 17: Settings Panel

**User Story:** As a user, I want to configure inference parameters and the server URL from the dashboard, so that I can tune the model's behavior without editing config files.

#### Acceptance Criteria

1. THE Settings_Panel SHALL expose controls for: goal (quality / speed / balanced), max tokens (integer input, 0 = unlimited), temperature (slider 0.0–2.0, step 0.01), and context length (integer input).
2. WHEN the user changes a setting, THE Dashboard SHALL persist the new value to `localStorage` immediately.
3. WHEN the Dashboard loads, THE Dashboard SHALL restore all settings from `localStorage`, falling back to defaults (goal: "balanced", max tokens: 0, temperature: 0.7, context length: 4096).
4. THE Settings_Panel SHALL include the LocAI_Server URL field described in Requirement 2.4.
5. WHEN the user changes a specific setting (temperature or max tokens), THE Dashboard SHALL apply only that changed setting to the next chat request without requiring a page reload.

---

### Requirement 18: OpenAI Server — Model Hub Endpoints

**User Story:** As a developer, I want the LocAI server to expose model management endpoints so the dashboard can display and control the model library without a separate backend.

#### Acceptance Criteria

1. THE LocAI_Server SHALL expose `GET /locai/models` that returns the full `ModelHub.status()` array serialized as JSON.
2. THE LocAI_Server SHALL expose `POST /locai/models/download` accepting `{ modelId: string, quantId: string }` in the request body, which SHALL start a background download via `ModelHub.download()` and return `{ status: "started" }`.
3. IF the requested `modelId` is not found in the catalog, THEN THE LocAI_Server SHALL return HTTP 404 with an error indicating the model was not found. IF the `modelId` exists but the `quantId` is not found, THEN THE LocAI_Server SHALL return HTTP 404 with an error indicating the quant was not found for that model.
4. THE LocAI_Server SHALL expose `DELETE /locai/models/:modelId/:quantId` which SHALL call `ModelHub.evict()` and return `{ status: "deleted" }`.
5. THE LocAI_Server SHALL expose `GET /locai/device` that returns the `DeviceProfile` of the current machine as JSON.
6. WHEN a download is in progress, `GET /locai/models` SHALL include the current `downloadProgress` fraction (0..1) for that model/quant pair.

---

### Requirement 19: CORS and Dashboard Integration

**User Story:** As a developer, I want the LocAI server to allow cross-origin requests from the dashboard's dev server, so that the dashboard can call the API during development without proxy configuration.

#### Acceptance Criteria

1. THE LocAI_Server SHALL include `Access-Control-Allow-Origin: *` (or the configured dashboard origin) in all HTTP responses.
2. THE LocAI_Server SHALL handle `OPTIONS` preflight requests for all endpoints and return the appropriate CORS headers.
3. WHEN the Dashboard is served from a different origin than the LocAI_Server, THE Dashboard SHALL be able to make all API calls without browser CORS errors.
