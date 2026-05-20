/**
 * S3/MinIO-style multipart strategy: sign each part on demand via `signPart`,
 * PUT, then finalize with `completeMultipart` using collected ETags. Resumable —
 * persists ETags in the cursor and skips already-completed sessions.
 */

import type { CursorMap, IntentMap, UploadResultBase, UploadStrategy } from '../../core/contracts'
import { sleep } from '../../core/utils/async'

const DEFAULT_MAX_PART_CONCURRENCY = 4

/**
 * Configuration for {@link multipartStrategy}.
 *
 * Security note: the per-part URL returned by `signPart` is fed straight to
 * the transport. A compromised backend or MITM can return a `file://`,
 * `javascript:`, or private-network URL. Configure {@link allowedHosts}
 * (preferred) or leave {@link allowPrivateHosts} at its default `false` to
 * block loopback/private addresses.
 */
export type MultipartStrategyConfig = {
  maxPartConcurrency?: number
  /**
   * Optional case-insensitive allow-list of host names (with optional port,
   * e.g. `upload.example.com:8443`). When set, every signed part URL must
   * match a listed host or it is rejected.
   */
  allowedHosts?: string[]
  /**
   * When `true`, allow private-network IP literals (loopback, RFC1918,
   * link-local, etc.) in signed part URLs. Defaults to `false`.
   */
  allowPrivateHosts?: boolean
}

export namespace MultipartStrategy {
  export type IConfig = MultipartStrategyConfig
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
 * Reject hosts that resolve (literally) to a private/loopback/link-local
 * address. We only block IP literals — DNS rebinding is out of scope for a
 * client-side check.
 */
function isPrivateHost(host: string): boolean {
  // IPv6 — strip surrounding brackets if present
  const v6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (v6.includes(':')) {
    const lc = v6.toLowerCase()
    if (lc === '::1' || lc === '::' || lc === '0:0:0:0:0:0:0:1' || lc === '0:0:0:0:0:0:0:0') return true
    // fc00::/7
    if (/^f[cd][0-9a-f]{0,2}:/.test(lc)) return true
    // fe80::/10
    if (/^fe[89ab][0-9a-f]?:/.test(lc)) return true
    return false
  }

  // IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 127) return true // 127.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 0) return true // 0.0.0.0/8
  return false
}

/**
 * Validate the per-part URL returned by `signPart` before it is handed to the
 * transport. Throws on rejection. Exposed for tests; not part of the public
 * API surface.
 *
 * @internal
 */
export function validatePartUrl(
  rawUrl: string,
  opts: { allowedHosts?: string[]; allowPrivateHosts?: boolean } = {},
): void {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new Error('multipart.signPart returned an invalid URL (empty or non-string)')
  }

  // Reject path-traversal segments in the raw input. `new URL` normalizes them
  // away, so check before parsing.
  if (rawUrl.includes('..')) {
    throw new Error('multipart.signPart URL contains forbidden ".." segment')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('multipart.signPart returned a malformed URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`multipart.signPart URL has forbidden protocol "${parsed.protocol}"`)
  }

  if (opts.allowedHosts && opts.allowedHosts.length > 0) {
    const host = parsed.host.toLowerCase()
    const list = opts.allowedHosts.map((h) => h.toLowerCase())
    if (!list.includes(host)) {
      throw new Error('multipart.signPart URL host is not in the configured allow-list')
    }
  } else if (!warnedMissingAllowedHosts) {
    warnedMissingAllowedHosts = true
    console.warn(
      '[duck-upload] multipartStrategy: no `allowedHosts` configured. Signed part URLs will be host-unrestricted. ' +
        'Set MultipartStrategy.IConfig.allowedHosts to lock the upload host.',
    )
  }

  if (!opts.allowPrivateHosts) {
    // Hostname strips an IPv6 bracket already; pass raw host so we can detect bracketed v6 forms too.
    if (isPrivateHost(parsed.hostname)) {
      throw new Error('multipart.signPart URL points to a private/loopback host')
    }
  }
}

export type MultipartIntent = {
  strategy: 'multipart'
  fileId: string
  uploadId: string
  partSize: number
  partCount: number

  // Optional legacy mode: backend might provide all urls up front
  parts?: Array<{
    partNumber: number
    url: string
    headers?: Record<string, string>
  }>
}

export type MultipartCursor = {
  done: Array<{
    partNumber: number
    etag: string
    size: number
  }>

  /**
   * Marks that the multipart session was completed on the backend (parts assembled).
   * This prevents re-sending completeMultipart on resume.
   */
  completed?: true
}

function isAbort(err: unknown) {
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
}

export function multipartStrategy<
  M extends IntentMap & { multipart: MultipartIntent },
  C extends CursorMap<M> & { multipart?: MultipartCursor },
  P extends string = string,
  R extends UploadResultBase = UploadResultBase,
>(opts?: MultipartStrategyConfig): UploadStrategy<M, C, P, R, 'multipart'> {
  const maxPartConcurrency = Math.max(1, opts?.maxPartConcurrency ?? DEFAULT_MAX_PART_CONCURRENCY)
  const allowedHosts = opts?.allowedHosts
  const allowPrivateHosts = opts?.allowPrivateHosts === true

  return {
    id: 'multipart',
    resumable: true,

    async start(ctx) {
      const intent = ctx.intent
      const totalBytes = ctx.file.size
      const partSize = Math.max(1, intent.partSize)

      // Trust backend `partCount` when provided — S3-style backends enforce a maxParts rule.
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
        // Legacy fast path: backend pre-signed all parts in `intent.parts`.
        const fromIntent = intent.parts?.find((x) => x.partNumber === partNumber)
        if (fromIntent) return fromIntent

        if (!ctx.api.multipart?.signPart) {
          throw new Error(
            'multipart.signPart is missing in UploadApi. Implement it to call your backend sign-part endpoint.',
          )
        }

        const out = await ctx.api.multipart.signPart(
          { fileId: intent.fileId, uploadId: intent.uploadId, partNumber },
          { signal: ctx.signal },
        )

        return { partNumber, url: out.url, headers: out.headers }
      }

      const uploadOne = async (
        p: { partNumber: number; start: number; end: number },
        retryCount = 0,
      ): Promise<void> => {
        const maxRetries = 3
        try {
          const blob = ctx.file.slice(p.start, p.end)
          const size = blob.size

          const signed = await getSignedPart(p.partNumber)

          // SEC-001: validate the per-part URL before handing it to the
          // transport. A compromised backend can otherwise pivot the browser
          // to `file://`, `javascript:`, or a private-network host.
          validatePartUrl(signed.url, { allowedHosts, allowPrivateHosts })

          const res = await ctx.transport.put({
            url: signed.url,
            body: blob,
            headers: signed.headers,
            signal: ctx.signal,
            onProgress: (loaded) => {
              inflightBytes.set(p.partNumber, loaded)
              report()
            },
          })

          inflightBytes.delete(p.partNumber)

          const etag = res.etag
          if (!etag) {
            throw new Error(
              'Missing ETag from upload part response. Ensure MinIO/S3 CORS exposes ETag (Access-Control-Expose-Headers: ETag).',
            )
          }

          finishedBytes += size
          done.set(p.partNumber, { etag, size })

          const snapshot: MultipartCursor = {
            done: Array.from(done.entries())
              .map(([partNumber, v]) => ({ partNumber, etag: v.etag, size: v.size }))
              .sort((a, b) => a.partNumber - b.partNumber),
          }
          ctx.persistCursor(snapshot as C['multipart'])
          report()
        } catch (err) {
          inflightBytes.delete(p.partNumber)

          if (ctx.signal?.aborted || isAbort(err)) throw err

          // Retry transient network errors with exponential backoff.
          if (retryCount < maxRetries) {
            const msg = err instanceof Error ? err.message : String(err)
            const retryable =
              /network/i.test(msg) ||
              /timeout/i.test(msg) ||
              /5\d\d/.test(msg) ||
              /ECONNRESET/i.test(msg) ||
              /EHOSTUNREACH/i.test(msg)

            if (retryable) {
              await sleep(2 ** retryCount * 500)
              return uploadOne(p, retryCount + 1)
            }
          }

          throw err
        }
      }

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
          throw new Error(
            'multipart.completeMultipart is missing in UploadApi. Implement it to call your backend complete endpoint.',
          )
        }

        const parts = Array.from(done.entries())
          .map(([partNumber, v]) => ({ partNumber, etag: v.etag }))
          .sort((a, b) => a.partNumber - b.partNumber)

        if (parts.length !== totalParts) {
          throw new Error(`Cannot complete multipart: expected ${totalParts} parts, got ${parts.length}`)
        }

        await ctx.api.multipart.completeMultipart(
          { fileId: intent.fileId, uploadId: intent.uploadId, parts },
          { signal: ctx.signal },
        )

        // Persist `completed: true` so resume after this point does not re-call `completeMultipart`.
        const snapshot: MultipartCursor = {
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
