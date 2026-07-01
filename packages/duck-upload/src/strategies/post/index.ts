import type { Contracts } from '../../core'
import { UploadEngineError } from '../../core'

export namespace PostStrategy {
  /**
   * Presigned HTTP POST strategy configuration options.
   */
  export type Config = {
    /**
     * Case-insensitive allow-list of host names (with optional port). When
     * set, the presigned POST URL must match a listed host or it is rejected.
     */
    allowedHosts?: string[]
    /**
     * When `true`, allow private-network IP literals in the POST URL.
     * Defaults to `false`.
     */
    allowPrivateHosts?: boolean
  }

  /**
   * Presigned HTTP POST intent payload mapping parameters returned by backend endpoints.
   */
  export type Intent = {
    /** Discriminant identifier matching strategy configuration registry keys. */
    strategy: 'post'
    /** Unique database identifier for the file resource. */
    fileId: string
    /** Presigned POST action destination URL (e.g. presigned S3/GCS bucket location). */
    url: string
    /** Key/value pair list representing form properties (e.g. AWS credential fields, policies). */
    fields: Record<string, string>
    /** Optional epoch string indicating when the pre-signed credentials lapse. */
    expiresAt?: string
  }

  /**
   * Direct strategy cursor state representing that no resumable bytes exist.
   */
  export type Cursor = Record<string, never>
}

/**
 * Presigned HTTP POST form strategy.
 *
 * Sends the entire file along with backend policy fields as a single
 * `multipart/form-data` request body. Does not support resumability.
 *
 * @example
 * ```ts
 * const strategies = createStrategyRegistry([
 *   PostStrategy(),
 *   MultipartStrategy()
 * ]);
 * ```
 */
export function PostStrategy<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(): Contracts.Strategy.Me<M, C, P, R, 'post'> {
  return {
    id: 'post',
    resumable: false,

    async start(ctx) {
      const intent = ctx.intent as unknown as PostStrategy.Intent

      if (!intent.url) {
        throw new UploadEngineError('validation_failed', { message: 'Direct strategy: intent missing url/uploadUrl' })
      }

      await ctx.transport.postForm({
        url: intent.url,
        file: ctx.file,
        fields: intent.fields,
        filename: ctx.file.name,
        signal: ctx.signal,
        onProgress(uploadedBytes, totalBytes) {
          ctx.reportProgress({ uploadedBytes, totalBytes })
        },
      })
    },
  }
}
