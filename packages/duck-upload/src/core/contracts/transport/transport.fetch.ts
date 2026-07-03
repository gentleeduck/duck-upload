import { abortReason, makeAbortError } from './transport.libs'
import type { Transport } from './transport.types'

/**
 * `fetch`-based transport for non-browser runtimes (Node, edge, workers, SSR)
 * and any environment without `XMLHttpRequest`.
 *
 * Trade-off vs {@link createXHRTransport}: `fetch` has no portable upload
 * progress API, so `put`/`postForm`/`patch` report a single terminal
 * `onProgress(total, total)` on success rather than incremental bytes. Download
 * (`get`) streams the response body, so its progress is real and incremental.
 *
 * @author wildduck2 <https://github.com/wildduck2>
 */

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Read a single-quotes-stripped ETag from response headers. */
function readEtag(headers: Headers): string | undefined {
  const raw = headers.get('etag') ?? headers.get('ETag')
  if (!raw) return undefined
  return raw.replace(/"/g, '')
}

/** Collect response headers into a lowercase-keyed record. */
function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

async function fetchRequest(args: {
  method: 'POST' | 'PUT' | 'PATCH'
  url: string
  body: BodyInit
  signal: AbortSignal
  headers?: Record<string, string> | undefined
  onProgress?: ((loaded: number, total: number) => void) | undefined
  byteLength: number
}): Promise<{ headers: Record<string, string>; etag?: string | undefined }> {
  if (!args.url || !isAbsoluteHttpUrl(args.url)) {
    throw new Error(`UploadTransport(fetch): expected absolute URL, got: ${String(args.url)}`)
  }
  if (args.signal.aborted) {
    throw makeAbortError(abortReason(args.signal))
  }

  const init: RequestInit = { method: args.method, body: args.body, signal: args.signal }
  if (args.headers) init.headers = args.headers

  let res: Response
  try {
    res = await fetch(args.url, init)
  } catch (err) {
    if (args.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw makeAbortError(abortReason(args.signal))
    }
    throw err instanceof Error ? err : new Error(String(err))
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Upload failed with status ${res.status}`)
  }

  // fetch cannot report streamed upload progress portably; emit a single
  // terminal tick so consumers can settle their progress bars.
  args.onProgress?.(args.byteLength, args.byteLength)

  return { headers: headersToRecord(res.headers), etag: readEtag(res.headers) }
}

/**
 * Create a `fetch`-backed {@link Transport.Options} implementation.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function createFetchTransport(): Transport.Options {
  return {
    async postForm(args) {
      const form = new FormData()
      for (const [k, v] of Object.entries(args.fields)) form.append(k, v)
      form.append('file', args.file, args.filename ?? 'file')

      const out = await fetchRequest({
        method: 'POST',
        url: args.url,
        body: form,
        signal: args.signal,
        byteLength: args.file.size,
        onProgress: args.onProgress,
      })
      return out.etag !== undefined ? { headers: out.headers, etag: out.etag } : { headers: out.headers }
    },

    async put(args) {
      const out = await fetchRequest({
        method: 'PUT',
        url: args.url,
        body: args.body,
        signal: args.signal,
        headers: args.headers ?? {},
        byteLength: args.body.size,
        onProgress: args.onProgress,
      })
      return { headers: out.headers, etag: out.etag }
    },

    async patch(args) {
      const body = args.body instanceof Blob ? args.body : new Blob([args.body])
      const out = await fetchRequest({
        method: 'PATCH',
        url: args.url,
        body,
        signal: args.signal,
        headers: args.headers ?? {},
        byteLength: body.size,
        onProgress: args.onProgress,
      })
      return { headers: out.headers }
    },

    async get(args) {
      if (!args.url || !isAbsoluteHttpUrl(args.url)) {
        throw new Error(`UploadTransport(fetch): expected absolute URL, got: ${String(args.url)}`)
      }
      if (args.signal.aborted) {
        throw makeAbortError(abortReason(args.signal))
      }

      const init: RequestInit = { method: 'GET', signal: args.signal }
      if (args.headers) init.headers = args.headers

      let res: Response
      try {
        res = await fetch(args.url, init)
      } catch (err) {
        if (args.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw makeAbortError(abortReason(args.signal))
        }
        throw err instanceof Error ? err : new Error(String(err))
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Download failed with status ${res.status}`)
      }

      const headers = headersToRecord(res.headers)
      const total = Number(res.headers.get('content-length')) || 0

      // Stream when possible for incremental progress; otherwise fall back to a
      // buffered read.
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            loaded += value.byteLength
            args.onProgress?.(loaded, total || loaded)
          }
        }
        const blob = new Blob(chunks as BlobPart[], {
          type: res.headers.get('content-type') ?? 'application/octet-stream',
        })
        return { blob, status: res.status, headers }
      }

      const blob = await res.blob()
      args.onProgress?.(blob.size, total || blob.size)
      return { blob, status: res.status, headers }
    },

    async head(args) {
      if (!args.url || !isAbsoluteHttpUrl(args.url)) {
        throw new Error(`UploadTransport(fetch): expected absolute URL, got: ${String(args.url)}`)
      }
      if (args.signal.aborted) {
        throw makeAbortError(abortReason(args.signal))
      }

      const init: RequestInit = { method: 'HEAD', signal: args.signal }
      if (args.headers) init.headers = args.headers

      let res: Response
      try {
        res = await fetch(args.url, init)
      } catch (err) {
        if (args.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw makeAbortError(abortReason(args.signal))
        }
        throw err instanceof Error ? err : new Error(String(err))
      }

      return { status: res.status, headers: headersToRecord(res.headers) }
    },
  }
}
