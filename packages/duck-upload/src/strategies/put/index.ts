import type { Contracts } from '../../core'
import { UploadEngineError } from '../../core'
import { validateUploadUrl } from '../../core/utils/url-safety'
import { withRetry } from '../_shared/retry'

/**
 * Types for the single-request presigned HTTP PUT upload strategy.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace PutStrategy {
  /**
   * Presigned HTTP PUT strategy configuration options.
   */
  export type Config = {
    /**
     * Case-insensitive allow-list of host names (with optional port). When
     * set, the presigned PUT URL must match a listed host or it is rejected.
     */
    allowedHosts?: string[]
    /**
     * When `true`, allow private-network IP literals in the PUT URL.
     * Defaults to `false`.
     */
    allowPrivateHosts?: boolean
    /**
     * Retries after the first attempt for transient network failures.
     * Defaults to the shared retry default (3).
     */
    maxRetries?: number
  }

  /**
   * Presigned HTTP PUT intent payload. The whole file body is sent in one
   * request to a backend-signed URL (e.g. S3 `putObject`, GCS signed PUT).
   */
  export type Intent = {
    /** Discriminant identifier matching strategy configuration registry keys. */
    strategy: 'put'
    /** Unique database identifier for the file resource. */
    fileId: string
    /** Presigned PUT destination URL. */
    url: string
    /** Optional request headers required by the signature (e.g. `Content-Type`). */
    headers?: Record<string, string>
    /** Optional epoch string indicating when the pre-signed credentials lapse. */
    expiresAt?: string
  }

  /**
   * Direct strategy cursor state representing that no resumable bytes exist.
   */
  export type Cursor = Record<string, never>
}

/** Convenience alias for {@link PutStrategy.Intent}. */
export type PutIntent = PutStrategy.Intent

let warnedMissingAllowedHosts = false

/**
 * Reset the warn-once latch. Test-only.
 * @internal
 */
export function __resetPutWarningsForTests(): void {
  warnedMissingAllowedHosts = false
}

/**
 * Presigned single-request HTTP PUT strategy.
 *
 * Sends the entire file as the request body to a backend-signed URL in one PUT.
 * The most common direct-to-storage pattern (S3 `putObject`, GCS/Azure signed
 * PUT). Not resumable — use {@link multipartStrategy} or the tus strategy for
 * resumable transfers.
 *
 * Security: the presigned URL is backend-supplied and flows straight to the
 * transport, so a compromised backend or MITM could return a `file:`,
 * `javascript:`, or private-network URL. Every URL is checked with
 * {@link validateUploadUrl}; set {@link PutStrategy.Config.allowedHosts} to
 * lock it to known hosts, or leave `allowPrivateHosts` at its default `false`
 * to block loopback/private addresses.
 *
 * @example
 * ```ts
 * const strategies = createStrategyRegistry([
 *   PutStrategy({ allowedHosts: ['uploads.example.com'] }),
 *   multipartStrategy(),
 * ]);
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function PutStrategy<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(opts: PutStrategy.Config = {}): Contracts.Strategy.Me<M, C, P, R, 'put'> {
  const allowedHosts = opts.allowedHosts ?? []
  const allowPrivateHosts = opts.allowPrivateHosts === true

  return {
    id: 'put',
    resumable: false,

    async start(ctx) {
      const intent = ctx.intent as unknown as PutStrategy.Intent

      if (!intent.url) {
        throw new UploadEngineError('validation_failed', { message: 'put.start: intent missing url' })
      }

      if (allowedHosts.length === 0 && !warnedMissingAllowedHosts) {
        warnedMissingAllowedHosts = true
        console.warn(
          '[duck-upload] PutStrategy: no `allowedHosts` configured. Presigned PUT URLs will be host-unrestricted. ' +
            'Set PutStrategy.Config.allowedHosts to lock the upload host.',
        )
      }

      validateUploadUrl(intent.url, 'put.intent', { allowedHosts, allowPrivateHosts })

      const totalBytes = ctx.file.size

      await withRetry(
        () =>
          ctx.transport.put({
            url: intent.url,
            body: ctx.file,
            headers: intent.headers ?? {},
            signal: ctx.signal,
            onProgress(uploadedBytes, total) {
              ctx.reportProgress({ uploadedBytes, totalBytes: total || totalBytes })
            },
          }),
        { signal: ctx.signal, ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}) },
      )
    },
  }
}
