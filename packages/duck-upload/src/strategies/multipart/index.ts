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
 * Converts a 32-bit IPv4 tail expressed as two colon-separated hex groups
 * (e.g. `7f00:1`) into dotted-quad form (`127.0.0.1`). Returns `null` if the
 * input is not a well-formed 32-bit hex tail. Both groups may be 1–4 hex
 * digits; the second group may be omitted leading zeros (`7f00:1` ==
 * `7f00:0001`).
 *
 * Ported verbatim from duck-iam (proven against rescans 003/004/006).
 */
function hexTailToDottedQuad(tail: string): string | null {
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
  if (!m) return null
  const hi = parseInt(m[1]!, 16)
  const lo = parseInt(m[2]!, 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null
  if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return null
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}

/**
 * Reject hosts that resolve (literally) to a private/loopback/link-local/
 * cloud-metadata/CGNAT/multicast/broadcast address. We only block IP literals
 * — DNS rebinding is out of scope for a client-side check.
 *
 * Ported from duck-iam's `_isPrivateHost` (proven across rescans 003/004/006).
 * Covers:
 * - IPv4: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 (link-local +
 *   AWS metadata 169.254.169.254), 0/8 (this-network), 100.64/10 (CGNAT),
 *   224/4 (multicast), 240/4 (reserved), 255.255.255.255 (broadcast).
 * - IPv6: ::1, ::, fc00::/7, fe80::/10, ff00::/8 (multicast).
 * - Embedded IPv4: IPv4-mapped (`::ffff:a.b.c.d`, hex form `::ffff:7f00:1`,
 *   fully expanded `0:0:0:0:0:ffff:...`), IPv4-compatible (`::a.b.c.d`),
 *   6to4 (`2002:AABB:CCDD::`), NAT64 (`64:ff9b::v4`) — all decoded and
 *   recursed against the IPv4 list.
 * - Strips a single trailing FQDN dot before checks.
 */
function isPrivateHost(host: string): boolean {
  // Strip surrounding brackets from IPv6 literals. Also strip a single
  // trailing FQDN dot so `127.0.0.1.` normalises to `127.0.0.1`.
  let h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (h.endsWith('.')) h = h.slice(0, -1)

  // IPv4 dotted-quad
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    const c = Number(v4[3])
    const d = Number(v4[4])
    if (a > 255 || b > 255 || c > 255 || d > 255) return false
    if (a === 127) return true // 127.0.0.0/8 loopback
    if (a === 10) return true // 10.0.0.0/8 RFC1918
    if (a === 192 && b === 168) return true // 192.168.0.0/16 RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 RFC1918
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (AWS metadata 169.254.169.254)
    if (a === 0) return true // 0.0.0.0/8 this-network (incl. unspecified)
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a >= 224 && a <= 239) return true // 224.0.0.0/4 multicast
    if (a >= 240) return true // 240.0.0.0/4 reserved + 255.255.255.255 broadcast
    return false
  }

  // IPv6 literal
  if (h.includes(':')) {
    const lower = h.toLowerCase()
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
    // fc00::/7 — first byte 0xfc or 0xfd
    if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true
    // fe80::/10 — fe8x, fe9x, feax, febx
    if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true
    // ff00::/8 — IPv6 multicast (mirrors IPv4 224/4 coverage)
    if (/^ff[0-9a-f]{0,2}:/.test(lower)) return true

    // IPv4-mapped IPv6 — `::ffff:a.b.c.d` (dotted-quad tail) or
    // `::ffff:hhhh:hhhh` (hex tail, canonical form Node's URL parser emits).
    // Also accept the fully expanded `0:0:0:0:0:ffff:...` form.
    let mappedTail: string | null = null
    if (lower.startsWith('::ffff:')) mappedTail = lower.slice(7)
    else if (lower.startsWith('0:0:0:0:0:ffff:')) mappedTail = lower.slice(15)
    if (mappedTail !== null) {
      if (mappedTail.includes('.')) return isPrivateHost(mappedTail)
      const dotted = hexTailToDottedQuad(mappedTail)
      if (dotted) return isPrivateHost(dotted)
      return false
    }

    // IPv4-compatible IPv6 (deprecated RFC4291 §2.5.5.1) — `::a.b.c.d`.
    if (lower.startsWith('::') && lower.includes('.')) {
      const tail = lower.slice(2)
      if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(tail)) return isPrivateHost(tail)
    }

    // 6to4 prefix `2002::/16` carries an inner IPv4 in the next two 16-bit
    // groups (`2002:AABB:CCDD::` → `A.B.C.D` with bytes AA,BB,CC,DD).
    // Linux ships 6to4 by default — `2002:7f00:1::` carries `127.0.0.1`.
    if (lower.startsWith('2002:')) {
      const m = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(lower)
      if (m) {
        const dotted = hexTailToDottedQuad(`${m[1]}:${m[2]}`)
        if (dotted) return isPrivateHost(dotted)
      }
    }

    // NAT64 well-known prefix `64:ff9b::/96` carries an inner IPv4 in the
    // last 32 bits. URL canonicalises leading zeros (`0064:ff9b:` →
    // `64:ff9b:`); accept both spellings defensively.
    if (lower.startsWith('64:ff9b:') || lower.startsWith('0064:ff9b:')) {
      const tail = lower.startsWith('0064:') ? lower.slice(10) : lower.slice(8)
      if (tail.includes('.')) {
        const v4match = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(tail)
        if (v4match) return isPrivateHost(v4match[1]!)
      }
      const groups = tail.split(':').filter((g) => g.length > 0)
      if (groups.length >= 2) {
        const dotted = hexTailToDottedQuad(`${groups[groups.length - 2]}:${groups[groups.length - 1]}`)
        if (dotted) return isPrivateHost(dotted)
      }
    }

    return false
  }

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
