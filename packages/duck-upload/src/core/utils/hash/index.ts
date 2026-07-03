/**
 * File hashing entry point.
 *
 * Small files use `crypto.subtle.digest` (native, fastest). Large files are
 * hashed incrementally so memory stays flat, off the main thread via a Web
 * Worker when the environment supports one, or inline on the current thread as
 * a fallback (Node/SSR/tests, or browsers without Worker/Blob URL support).
 *
 * @author wildduck2 <https://github.com/wildduck2>
 */

import { DEFAULT_HASH_CHUNK_SIZE, sha256HexOfBlob } from './sha256'

export { DEFAULT_HASH_CHUNK_SIZE, sha256HexOfBlob }

/** Native Web Crypto digest of a fully-buffered blob. Lowercase hex. */
async function sha256HexViaSubtle(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** True when this realm can spin up a Blob-URL Web Worker. */
function canUseWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  )
}

let workerScriptUrl: string | null = null

/**
 * Build (once) an object-URL for a worker that runs {@link sha256HexOfBlob}.
 * The function is self-contained, so stringifying it yields valid worker source.
 */
function getWorkerScriptUrl(): string {
  if (workerScriptUrl) return workerScriptUrl
  const source = `const sha256HexOfBlob = ${sha256HexOfBlob.toString()};
self.onmessage = async (e) => {
  try {
    const hex = await sha256HexOfBlob(e.data.blob, { chunkSize: e.data.chunkSize });
    self.postMessage({ ok: true, hex });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};`
  const blob = new Blob([source], { type: 'application/javascript' })
  workerScriptUrl = URL.createObjectURL(blob)
  return workerScriptUrl
}

/** Hash `blob` in a Web Worker. Rejects if the worker errors. */
function sha256HexInWorker(blob: Blob, chunkSize: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(getWorkerScriptUrl())
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const done = (fn: () => void) => {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      fn()
    }

    worker.onmessage = (e: MessageEvent<{ ok: boolean; hex?: string; error?: string }>) => {
      const data = e.data
      if (data.ok && typeof data.hex === 'string') {
        done(() => resolve(data.hex as string))
      } else {
        done(() => reject(new Error(data.error ?? 'hash worker failed')))
      }
    }
    worker.onerror = (e) => {
      done(() => reject(new Error(e.message || 'hash worker error')))
    }

    worker.postMessage({ blob, chunkSize })
  })
}

/**
 * Compute the lowercase hex SHA-256 of `blob`.
 *
 * @param blob - Source bytes.
 * @param opts.inlineMaxSize - At or below this size, hash inline with Web Crypto
 *   (fast, buffers the whole blob). Above it, hash incrementally — off-thread
 *   when a Worker is available, otherwise inline-incremental. Defaults to
 *   {@link DEFAULT_HASH_CHUNK_SIZE}.
 * @param opts.chunkSize - Slice size for incremental hashing.
 * @param opts.signal - Abort signal (honored on the inline-incremental path).
 */
export async function hashBlob(
  blob: Blob,
  opts?: { inlineMaxSize?: number; chunkSize?: number; signal?: AbortSignal },
): Promise<string> {
  const inlineMax =
    typeof opts?.inlineMaxSize === 'number' && Number.isFinite(opts.inlineMaxSize) && opts.inlineMaxSize > 0
      ? opts.inlineMaxSize
      : DEFAULT_HASH_CHUNK_SIZE
  const chunkSize = opts?.chunkSize ?? DEFAULT_HASH_CHUNK_SIZE

  if (blob.size <= inlineMax && typeof crypto !== 'undefined' && crypto.subtle) {
    return sha256HexViaSubtle(blob)
  }

  if (canUseWorker() && !opts?.signal) {
    try {
      return await sha256HexInWorker(blob, chunkSize)
    } catch {
      // Fall through to inline-incremental on any worker failure.
    }
  }

  return opts?.signal ? sha256HexOfBlob(blob, { chunkSize, signal: opts.signal }) : sha256HexOfBlob(blob, { chunkSize })
}
