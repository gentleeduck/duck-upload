/**
 * tus resumable upload strategy (creation-less).
 *
 * The backend intent hands back a ready tus upload URL (creation is done
 * server-side), so this strategy implements only the transfer half of the
 * protocol: HEAD to read the server's `Upload-Offset`, then a sequence of
 * `PATCH` requests with `application/offset+octet-stream` bodies. The offset is
 * persisted in the cursor so a resumed run continues where it left off, and
 * re-confirmed against the server via HEAD when the transport supports it.
 *
 * @see https://tus.io/protocols/resumable-upload
 */

import type { Contracts } from '../../core'
import { UploadEngineError } from '../../core'
import { validateUploadUrl } from '../../core/utils/url-safety'
import { withRetry } from '../_shared/retry'

/** tus protocol version this strategy speaks. */
const TUS_RESUMABLE = '1.0.0'

/** Default PATCH chunk size when neither intent nor config specifies one: 8 MiB. */
const DEFAULT_TUS_CHUNK_SIZE = 8 * 1024 * 1024

/**
 * Types for the tus resumable upload strategy.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace TusStrategy {
  /**
   * Configuration options for the tus strategy.
   */
  export type Config = {
    /** PATCH chunk size in bytes. Overridden by `intent.chunkSize`. Defaults to 8 MiB. */
    chunkSize?: number
    /**
     * Case-insensitive allow-list of host names (with optional port). When set,
     * the tus upload URL must match a listed host or it is rejected.
     */
    allowedHosts?: string[]
    /**
     * When `true`, allow private-network IP literals in the tus URL.
     * Defaults to `false`.
     */
    allowPrivateHosts?: boolean
    /** Retries after the first attempt for transient PATCH/HEAD failures. Defaults to 3. */
    maxRetries?: number
  }

  /**
   * tus intent payload. The backend has already created the upload; `url` is the
   * ready upload resource to PATCH against.
   */
  export type Intent = {
    /** Discriminant matching strategy configuration registry keys. */
    strategy: 'tus'
    /** Unique database identifier for the file resource. */
    fileId: string
    /** Ready tus upload URL (backend-created via the creation extension). */
    url: string
    /** Optional per-upload chunk size override in bytes. */
    chunkSize?: number
    /** Optional extra headers to send on every request (e.g. auth). */
    headers?: Record<string, string>
  }

  /**
   * Persisted resume state: the last acknowledged upload offset in bytes.
   */
  export type Cursor = {
    /** Byte offset already accepted by the server. */
    offset: number
  }
}

/** Convenience alias for {@link TusStrategy.Intent}. */
export type TusIntent = TusStrategy.Intent

let warnedMissingAllowedHosts = false

/**
 * Reset the warn-once latch. Test-only.
 * @internal
 */
export function __resetTusWarningsForTests(): void {
  warnedMissingAllowedHosts = false
}

/** Parse a non-negative integer header value, or `null` when absent/invalid. */
function parseOffsetHeader(headers: Record<string, string> | undefined, name: string): number | null {
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * tus resumable upload strategy (creation-less).
 *
 * @example
 * ```ts
 * const registry = createStrategyRegistry([
 *   TusStrategy({ allowedHosts: ['tus.example.com'], chunkSize: 8 * 1024 * 1024 }),
 * ]);
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function TusStrategy<
  M extends Contracts.Intent.Map & { tus: TusStrategy.Intent },
  C extends Contracts.Cursor.Map<M> & { tus?: TusStrategy.Cursor },
  P extends string = string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(opts: TusStrategy.Config = {}): Contracts.Strategy.Me<M, C, P, R, 'tus'> {
  const allowedHosts = opts.allowedHosts ?? []
  const allowPrivateHosts = opts.allowPrivateHosts === true
  const configChunkSize = opts.chunkSize
  const retryOpts = opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}

  return {
    id: 'tus',
    resumable: true,

    async start(ctx) {
      const intent = ctx.intent
      if (!intent.url) {
        throw new UploadEngineError('validation_failed', { message: 'tus.start: intent missing url' })
      }

      if (allowedHosts.length === 0 && !warnedMissingAllowedHosts) {
        warnedMissingAllowedHosts = true
        console.warn(
          '[duck-upload] TusStrategy: no `allowedHosts` configured. tus upload URLs will be host-unrestricted. ' +
            'Set TusStrategy.Config.allowedHosts to lock the upload host.',
        )
      }

      validateUploadUrl(intent.url, 'tus.intent', { allowedHosts, allowPrivateHosts })

      const url = intent.url
      const total = ctx.file.size
      const chunkSize = Math.max(1, intent.chunkSize ?? configChunkSize ?? DEFAULT_TUS_CHUNK_SIZE)
      const baseHeaders: Record<string, string> = { 'Tus-Resumable': TUS_RESUMABLE, ...(intent.headers ?? {}) }

      // Start from the persisted offset, then confirm against the server when
      // the transport can HEAD (server offset is authoritative on resume).
      let offset = ctx.readCursor()?.offset ?? 0

      if (ctx.transport.head) {
        const head = ctx.transport.head
        try {
          const res = await withRetry(() => head({ url, headers: baseHeaders, signal: ctx.signal }), {
            signal: ctx.signal,
            ...retryOpts,
          })
          const serverOffset = parseOffsetHeader(res.headers, 'upload-offset')
          if (serverOffset !== null) offset = serverOffset
        } catch (err) {
          // Abort must propagate; other HEAD failures fall back to the cursor
          // offset and let the first PATCH surface a real error.
          if (ctx.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err
        }
      }

      // Clamp a stale/oversized persisted offset back into range.
      if (offset > total) offset = total

      ctx.reportProgress({ uploadedBytes: offset, totalBytes: total })

      while (offset < total) {
        if (ctx.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')

        const start = offset
        const end = Math.min(total, start + chunkSize)
        const chunk = ctx.file.slice(start, end)

        const res = await withRetry(
          () =>
            ctx.transport.patch({
              url,
              body: chunk,
              headers: {
                ...baseHeaders,
                'Upload-Offset': String(start),
                'Content-Type': 'application/offset+octet-stream',
              },
              signal: ctx.signal,
              onProgress: (loaded) => {
                ctx.reportProgress({ uploadedBytes: start + loaded, totalBytes: total })
              },
            }),
          { signal: ctx.signal, ...retryOpts },
        )

        // Trust the server's acknowledged offset; fall back to the local end.
        const acked = parseOffsetHeader(res.headers, 'upload-offset')
        offset = acked !== null ? acked : end

        if (offset <= start) {
          // No forward progress -> a broken/misconfigured server. Bail rather
          // than spin forever.
          throw new UploadEngineError('upload_failed', {
            message: `tus: server did not advance Upload-Offset (stuck at ${offset} of ${total}).`,
          })
        }

        ctx.persistCursor({ offset } as C['tus'])
        ctx.reportProgress({ uploadedBytes: offset, totalBytes: total })
      }
    },
  }
}
