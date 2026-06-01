/**
 * Shared OPFS-based model cache for browser inference engines.
 *
 * Both WasmEngine and WebGPUEngine share this cache to avoid re-downloading
 * models. Files are stored at /models/{modelId}/{quantId}.gguf in OPFS.
 */

export interface CachedModelInfo {
  modelId: string;
  quantId: string;
  sizeBytes: number;
}

export interface DownloadOptions {
  onProgress?: (bytesLoaded: number, bytesTotal: number) => void;
  signal?: AbortSignal;
}

export class ModelCache {
  /**
   * Check if a model is already cached in OPFS.
   */
  async has(_modelId: string, _quantId: string): Promise<boolean> {
    // TODO: implement OPFS lookup
    return false;
  }

  /**
   * Get a cached model's bytes from OPFS, or download and cache it.
   */
  async getOrDownload(
    _modelId: string,
    _quantId: string,
    _url: string,
    _options?: DownloadOptions,
  ): Promise<Uint8Array> {
    // TODO: implement OPFS cache with download fallback
    throw new Error("ModelCache.getOrDownload not yet implemented");
  }

  /**
   * List all models currently cached in OPFS.
   */
  async list(): Promise<CachedModelInfo[]> {
    // TODO: implement OPFS directory listing
    return [];
  }

  /**
   * Delete a cached model from OPFS.
   */
  async delete(_modelId: string, _quantId: string): Promise<void> {
    // TODO: implement OPFS deletion
  }
}
