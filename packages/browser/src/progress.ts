/**
 * Progress event types for browser engine model loading and inference.
 */

export interface LoadProgressEvent {
  phase: "download" | "load" | "ready";
  bytesLoaded?: number;
  bytesTotal?: number;
  fraction: number;
}

export type ProgressCallback = (event: LoadProgressEvent) => void;
