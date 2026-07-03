/**
 * Shared retry helpers used by upload strategies.
 *
 * Centralizes the abort detection, transient-error classification, and
 * exponential-backoff loop that `multipart` grew inline and that `post` and
 * `tus` reuse.
 * @author wildduck2 <https://github.com/wildduck2>
 */

import { sleep } from '../../core/utils/async'

/** Default number of retries (attempts after the first) for transient failures. */
export const DEFAULT_MAX_RETRIES = 3

/** Base backoff in ms; delay for retry `n` (0-indexed) is `2 ** n * BASE`. */
const BACKOFF_BASE_MS = 500

/**
 * True when `err` represents an aborted request (either an `AbortError` or a
 * message mentioning "abort"). Aborts are never retried.
 */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
}

/**
 * Classify an error as a transient network failure worth retrying. Matches
 * network/timeout wording, 5xx status codes, and common Node socket errnos.
 */
export function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /network/i.test(msg) ||
    /timeout/i.test(msg) ||
    /5\d\d/.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /EHOSTUNREACH/i.test(msg)
  )
}

/** Options for {@link withRetry}. */
export type WithRetryOptions = {
  /** Retries after the first attempt. Defaults to {@link DEFAULT_MAX_RETRIES}. */
  maxRetries?: number
  /**
   * Abort signal. When aborted (or the error is an abort) the loop stops
   * immediately and rethrows without further retries.
   */
  signal?: AbortSignal
  /**
   * Custom retry predicate. Defaults to {@link isRetryable}. Aborts are always
   * terminal regardless of this predicate.
   */
  retryable?: (err: unknown) => boolean
}

/**
 * Run `fn` and retry transient failures with exponential backoff.
 *
 * Aborts (signal aborted, or an abort-shaped error) short-circuit and rethrow
 * immediately. Non-retryable errors rethrow on first failure. `fn` receives the
 * zero-based attempt index.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: WithRetryOptions = {}): Promise<T> {
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES)
  const retryable = opts.retryable ?? isRetryable

  let attempt = 0
  for (;;) {
    try {
      return await fn(attempt)
    } catch (err) {
      if (opts.signal?.aborted || isAbort(err)) throw err
      if (attempt >= maxRetries || !retryable(err)) throw err
      await sleep(2 ** attempt * BACKOFF_BASE_MS)
      attempt++
    }
  }
}
