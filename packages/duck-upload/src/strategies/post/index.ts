import type { Contracts } from '../../core'
import { UploadEngineError } from '../../core'
import { validateUploadUrl } from '../../core/utils/url-safety'

/**
 * Types for the presigned HTTP POST upload strategy.
 * @author wildduck2 <https://github.com/wildduck2>
 */
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

/** Convenience alias for {@link PostStrategy.Intent}. */
export type PostIntent = PostStrategy.Intent

let warnedMissingAllowedHosts = false

/**
 * Reset the warn-once latch. Test-only.
 * @internal
 */
export function __resetPostWarningsForTests(): void {
  warnedMissingAllowedHosts = false
}

/**
 * Presigned HTTP POST form strategy.
 *
 * Sends the entire file along with backend policy fields as a single
 * `multipart/form-data` request body. Does not support resumability.
 *
 * Security: the presigned URL is backend-supplied and flows straight to the
 * transport, so a compromised backend or MITM could return a `file:`,
 * `javascript:`, or private-network URL. Every URL is checked with
 * {@link validateUploadUrl}; set {@link PostStrategy.Config.allowedHosts} to
 * lock it to known hosts, or leave `allowPrivateHosts` at its default `false`
 * to block loopback/private addresses.
 *
 * @example
 * ```ts
 * const strategies = createStrategyRegistry([
 *   PostStrategy({ allowedHosts: ['uploads.example.com'] }),
 *   MultipartStrategy()
 * ]);
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function PostStrategy<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(opts: PostStrategy.Config = {}): Contracts.Strategy.Me<M, C, P, R, 'post'> {
  const allowedHosts = opts.allowedHosts ?? []
  const allowPrivateHosts = opts.allowPrivateHosts === true

  return {
    id: 'post',
    resumable: false,

    async start(ctx) {
      const intent = ctx.intent as unknown as PostStrategy.Intent

      if (!intent.url) {
        throw new UploadEngineError('validation_failed', { message: 'post.start: intent missing url' })
      }

      if (allowedHosts.length === 0 && !warnedMissingAllowedHosts) {
        warnedMissingAllowedHosts = true
        console.warn(
          '[duck-upload] PostStrategy: no `allowedHosts` configured. Presigned POST URLs will be host-unrestricted. ' +
            'Set PostStrategy.Config.allowedHosts to lock the upload host.',
        )
      }

      validateUploadUrl(intent.url, 'post.intent', { allowedHosts, allowPrivateHosts })

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
