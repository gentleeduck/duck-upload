export namespace Transport {
  /**
   * Abstraction layer for network operations.
   * Allows switching between XHR (browser) or other implementations (testing/Node).
   *
   * Designed to support:
   * - Deterministic progress tracking (requires XHR in browsers)
   * - Cancellation via AbortSignal
   * - Header parsing (ETag extraction)
   */
  export type Options = {
    /**
     * Performs an HTTP PUT request (typically for S3 signed URLs).
     */
    put(args: {
      url: string
      body: Blob
      headers?: Record<string, string>
      signal: AbortSignal
      onProgress?: (u: number, t: number) => void
    }): Promise<{ etag?: string | undefined; headers?: Record<string, string> }>

    /**
     * Performs an HTTP POST multipart request.
     */
    postForm(args: {
      url: string
      fields: Record<string, string>
      file: File | Blob
      filename?: string
      signal: AbortSignal
      onProgress?: (uploadedBytes: number, totalBytes: number) => void
    }): Promise<{ etag?: string; headers?: Record<string, string> }>

    /**
     * Performs an HTTP request.
     */
    patch(args: {
      url: string
      body: Blob | ArrayBuffer
      headers?: Record<string, string>
      signal: AbortSignal
      onProgress?: (u: number, t: number) => void
    }): Promise<{ headers?: Record<string, string> }>
  }

  export type XhrArgs = {
    url: string
    signal?: AbortSignal
    headers?: Record<string, string>
    onProgress?: (loaded: number, total: number) => void
  }
}
