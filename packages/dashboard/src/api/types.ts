/**
 * API response types for the LocAI dashboard.
 *
 * These mirror the server-side types but are kept independent to avoid
 * importing Node.js dependencies into the browser bundle.
 */

// ---------------------------------------------------------------------------
// Device Profile
// ---------------------------------------------------------------------------

export type Platform =
  | "macos"
  | "windows"
  | "linux"
  | "ios"
  | "android"
  | "browser";

export type CpuArch = "arm64" | "x64" | "wasm32" | "unknown";

export type BackendKind =
  | "cpu"
  | "metal"
  | "cuda"
  | "vulkan"
  | "rocm"
  | "sycl"
  | "webgpu"
  | "wasm"
  | "coreml"
  | "qnn"
  | "openvino";

export interface AcceleratorInfo {
  kind: BackendKind;
  name: string;
  memoryBytes?: number;
  unifiedMemory?: boolean;
  perfHint?: number;
  available: boolean;
}

export interface DeviceProfile {
  platform: Platform;
  arch: CpuArch;
  totalRamBytes: number;
  usableRamBytes: number;
  cpu: {
    brand: string;
    physicalCores: number;
    logicalCores: number;
    features: string[];
  };
  accelerators: AcceleratorInfo[];
  memoryBandwidthGBs?: number;
  thermallyConstrained: boolean;
  freeDiskBytes?: number;
  capturedAt: string;
  source: "node" | "browser" | "react-native" | "synthetic";
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type FitClass = "comfortable" | "tight" | "thrash" | "over-cliff";

export interface PlanResponse {
  model: {
    id: string;
    displayName: string;
    paramsB: number;
  };
  quant: {
    id: string;
    bitsPerWeight: number;
  };
  backend: BackendKind;
  predicted: {
    tokensPerSecEstimate: number;
    memoryPressure: number;
    qualityRetention: number;
    fitClass: FitClass;
  };
  rationale: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Model Hub
// ---------------------------------------------------------------------------

export type ModelAvailability =
  | "ready"
  | "downloading"
  | "queued"
  | "available"
  | "no-space";

export interface ModelStatus {
  model: {
    id: string;
    displayName: string;
    paramsB: number;
  };
  quant: {
    id: string;
    bitsPerWeight: number;
  };
  availability: ModelAvailability;
  localPath?: string;
  downloadProgress?: number;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Chat / SSE Events
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages: ChatMessage[];
  stream: boolean;
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type AgenticSSEEvent =
  | { event: "tool_call"; data: { id: string; name: string; arguments: Record<string, unknown> } }
  | { event: "tool_result"; data: { id: string; name: string; results: unknown } }
  | { event: "token"; data: { content: string; stop: boolean } }
  | { event: "done" };
