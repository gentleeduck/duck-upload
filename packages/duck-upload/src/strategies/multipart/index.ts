/**
 * S3/MinIO-style multipart strategy: sign each part on demand via `signPart`,
 * PUT, then finalize with `completeMultipart` using collected ETags. Resumable
 * persists ETags in the cursor and skips already-completed sessions.
 */

import type { Contracts } from '../../core'
import { UploadEngineError } from '../../core'
import { validateUploadUrl } from '../../core/utils/url-safety'
import { withRetry } from '../_shared/retry'

const DEFAULT_MAX_PART_CONCURRENCY = 4

/**
 * Namespace containing types and interfaces specific to the S3/MinIO multipart upload strategy.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace MultipartStrategy {
  /**
   * Configuration options for the multipart upload strategy.
   */
  export type Config = {
    /** Maximum concurrent HTTP PUT part uploads. Defaults to 4. */
    maxPartConcurrency?: number
    /**
     * Optional case-insensitive list of trusted hosts (with optional port, e.g. `upload.example.com`).
     * When specified, every signed part URL must match one of the listed hosts.
     */
    allowedHosts?: string[]
    /**
     * When `true`, allows private network IP addresses (loopback, link-local, RFC1918) in signed part URLs.
     * Defaults to `false`.
     */
    allowPrivateHosts?: boolean
  }

  /**
   * Intent payload detailing part sizing and active upload session IDs returned by backends.
   */
  export type Intent = {
    /** Discriminant matching strategy configuration registry keys. */
    strategy: 'multipart'
    /** Unique database identifier for the file resource. */
    fileId: string
    /** Active multipart session ID returned by S3/GCS. */
    uploadId: string
    /** Chunk size in bytes for each part slice (typically 5MB minimum). */
    partSize: number
    /** Total count of parts predicted for this file size. */
    partCount: number

    /** Optional array of pre-generated URLs and headers for each part (if signed up front). */
    parts?: Array<{
      partNumber: number
      url: string
      headers?: Record<string, string>
    }>
  }

  /**
   * Persisted resume state for multipart strategy uploads.
   */
  export type Cursor = {
    /** List of completed parts. */
    done: Array<{
      partNumber: number
      etag: string
      size: number
    }>

    /**
     * True if the backend assembled the parts.
     * Prevents repeating completeMultipart calls on subsequent resume attempts.
     */
    completed?: true
  }
}

let warnedMissingAllowedHosts = false

/**
 * Reset internal warn-once latches. Test-only.
 *
 * @internal
 */
export function __resetMultipartWarningsForTests(): void {
  warnedMissingAllowedHosts = false
}

/**
 * Validate the per-part URL returned by `signPart` before it reaches the
 * transport. Delegates to the shared {@link validateUploadUrl} SSRF guard and
 * warns once when no `allowedHosts` are configured. Throws on rejection.
 *
 * @internal
 */
export function validatePartUrl(
  rawUrl: string,
  opts: { allowedHosts?: string[]; allowPrivateHosts?: boolean } = {},
): void {
  if ((!opts.allowedHosts || opts.allowedHosts.length === 0) && !warnedMissingAllowedHosts) {
    warnedMissingAllowedHosts = true
    console.warn(
      '[duck-upload] multipartStrategy: no `allowedHosts` configured. Signed part URLs will be host-unrestricted. ' +
        'Set MultipartStrategy.Config.allowedHosts to lock the upload host.',
    )
  }
  validateUploadUrl(rawUrl, 'multipart.signPart', opts)
}

// types moved to MultipartStrategy namespace above

/**
 * S3/GCS-compatible Resumable Multipart Upload Strategy.
 *
 * Slices files into chunks, uploads them concurrently using S3 PUT requests,
 * and completes the upload on the backend once all chunks are transferred.
 *
 * @example
 * ```ts
 * const registry = createStrategyRegistry([
 *   multipartStrategy({ maxPartConcurrency: 4 })
 * ]);
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function multipartStrategy<
  M extends Contracts.Intent.Map & { multipart: MultipartStrategy.Intent },
  C extends Contracts.Cursor.Map<M> & { multipart?: MultipartStrategy.Cursor },
  P extends string = string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(opts?: MultipartStrategy.Config): Contracts.Strategy.Me<M, C, P, R, 'multipart'> {
  const maxPartConcurrency = Math.max(1, opts?.maxPartConcurrency ?? DEFAULT_MAX_PART_CONCURRENCY)
  const allowedHosts = opts?.allowedHosts ?? []
  const allowPrivateHosts = opts?.allowPrivateHosts === true

  return {
    id: 'multipart',
    resumable: true,

    async start(ctx) {
      const intent = ctx.intent
      const totalBytes = ctx.file.size
      const partSize = Math.max(1, intent.partSize)

      // Trust backend `partCount` when provided  S3-style backends enforce a maxParts rule.
      const totalParts = Math.max(1, intent.partCount ?? Math.ceil(totalBytes / partSize))

      const cursor = ctx.readCursor()
      const done = new Map<number, { etag: string; size: number }>()
      if (cursor?.done) {
        for (const p of cursor.done) done.set(p.partNumber, { etag: p.etag, size: p.size })
      }

      // Skip re-completing if a previous run already finalized the multipart
      // session. The store still runs its generic finalization step.
      const alreadyCompleted = cursor?.completed === true

      const inflightBytes = new Map<number, number>()
      let finishedBytes = 0
      for (const v of done.values()) finishedBytes += v.size

      const report = () => {
        let inflight = 0
        for (const b of inflightBytes.values()) inflight += b
        ctx.reportProgress({ uploadedBytes: finishedBytes + inflight, totalBytes })
      }

      const partsToUpload: Array<{ partNumber: number; start: number; end: number }> = []
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (done.has(partNumber)) continue
        const start = (partNumber - 1) * partSize
        const end = Math.min(totalBytes, start + partSize)
        partsToUpload.push({ partNumber, start, end })
      }

      if (partsToUpload.length === 0) {
        if (!alreadyCompleted) await completeMultipart()
        report()
        return
      }

      const queue = partsToUpload.slice()
      const running = new Set<Promise<void>>()

      const getSignedPart = async (partNumber: number) => {
        // Fast path: backend pre-signed all parts in `intent.parts`.
        const fromIntent = intent.parts?.find((x) => x.partNumber === partNumber)
        if (fromIntent) return fromIntent

        if (!ctx.api.multipart?.signPart) {
          throw new UploadEngineError('validation_failed', {
            message:
              'multipart.signPart is missing in UploadApi. Implement it to call your backend sign-part endpoint.',
          })
        }

        const out = await ctx.api.multipart.signPart(
          { fileId: intent.fileId, uploadId: intent.uploadId, partNumber, attempt: ctx.attempt },
          {
            localId: ctx.localId,
            purpose: ctx.purpose,
            file: ctx.file,
            intent: ctx.intent,
            signal: ctx.signal,
            fingerprint: ctx.fingerprint,
            attempt: ctx.attempt,
            createdAt: ctx.createdAt,
            steps: ctx.steps,
            meta: ctx.meta,
            lastError: ctx.lastError,
          },
        )

        return { partNumber, url: out.url, headers: out.headers }
      }

      const uploadOne = (p: { partNumber: number; start: number; end: number }): Promise<void> =>
        withRetry(
          async () => {
            try {
              const blob = ctx.file.slice(p.start, p.end)
              const size = blob.size

              const signed = await getSignedPart(p.partNumber)

              validatePartUrl(signed.url, { allowedHosts, allowPrivateHosts })

              const res = await ctx.transport.put({
                url: signed.url,
                body: blob,
                headers: signed.headers ?? {},
                signal: ctx.signal,
                onProgress: (loaded) => {
                  inflightBytes.set(p.partNumber, loaded)
                  report()
                },
              })

              inflightBytes.delete(p.partNumber)

              const etag = res.etag
              if (!etag) {
                throw new UploadEngineError('upload_failed', {
                  message:
                    'Missing ETag from upload part response. Ensure MinIO/S3 CORS exposes ETag (Access-Control-Expose-Headers: ETag).',
                })
              }

              finishedBytes += size
              done.set(p.partNumber, { etag, size })

              const snapshot: MultipartStrategy.Cursor = {
                done: Array.from(done.entries())
                  .map(([partNumber, v]) => ({ partNumber, etag: v.etag, size: v.size }))
                  .sort((a, b) => a.partNumber - b.partNumber),
              }
              ctx.persistCursor(snapshot as C['multipart'])
              report()
            } catch (err) {
              // Clear this part's in-flight bytes before retry/rethrow so the
              // progress total does not double-count a re-attempted part.
              inflightBytes.delete(p.partNumber)
              throw err
            }
          },
          { signal: ctx.signal },
        )

      while (queue.length > 0 || running.size > 0) {
        while (queue.length > 0 && running.size < maxPartConcurrency) {
          const next = queue.shift()
          if (!next) break

          let task: Promise<void> | undefined
          const wrapped = uploadOne(next).finally(() => {
            if (task) running.delete(task)
          })
          task = wrapped
          running.add(wrapped)
        }

        if (running.size > 0) {
          await Promise.race(running)
        }
      }

      await completeMultipart()
      report()

      async function completeMultipart() {
        if (alreadyCompleted) return
        if (!ctx.api.multipart?.completeMultipart) {
          throw new UploadEngineError('validation_failed', {
            message:
              'multipart.completeMultipart is missing in UploadApi. Implement it to call your backend complete endpoint.',
          })
        }

        const parts = Array.from(done.entries())
          .map(([partNumber, v]) => ({ partNumber, etag: v.etag }))
          .sort((a, b) => a.partNumber - b.partNumber)

        if (parts.length !== totalParts) {
          throw new UploadEngineError('complete_failed', {
            message: `Cannot complete multipart: expected ${totalParts} parts, got ${parts.length}`,
          })
        }

        await ctx.api.multipart.completeMultipart(
          { fileId: intent.fileId, uploadId: intent.uploadId, parts },
          {
            localId: ctx.localId,
            purpose: ctx.purpose,
            file: ctx.file,
            intent: ctx.intent,
            signal: ctx.signal,
            fingerprint: ctx.fingerprint,
            attempt: ctx.attempt,
            createdAt: ctx.createdAt,
            steps: ctx.steps,
            meta: ctx.meta,
            lastError: ctx.lastError,
          },
        )

        // Persist `completed: true` so resume after this point does not re-call `completeMultipart`.
        const snapshot: MultipartStrategy.Cursor = {
          done: Array.from(done.entries())
            .map(([partNumber, v]) => ({ partNumber, etag: v.etag, size: v.size }))
            .sort((a, b) => a.partNumber - b.partNumber),
          completed: true,
        }
        ctx.persistCursor(snapshot as C['multipart'])
      }
    },
  }
}
