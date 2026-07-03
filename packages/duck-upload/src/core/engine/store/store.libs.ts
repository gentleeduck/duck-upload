import type { Contracts } from '../../contracts'
import type { UploadError } from '../../errors'
import { DEFAULT_RETRY_DELAY_BASE_MS, DEFAULT_RETRY_DELAY_MAX_MS } from '../../utils/constants'
import { computeFingerprint, fingerprintMatches } from '../../utils/fingerprint'
import { isRecord } from '../../utils/guards'
import type { Engine } from '../engine.types'
import type { Store } from './store.types'

export { sleep } from '../../utils/async'

/** Build enriched API context from a live item for passing to any backend API method. */
export function buildApiContext<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(item: Engine.Item<M, C, P, R>, overrides: Partial<Contracts.Api.Context<P, M>> = {}): Contracts.Api.Context<P, M> {
  const lastErrorStep = [...item.steps].reverse().find((s) => s.error !== undefined)
  return {
    localId: item.localId,
    purpose: item.purpose,
    fingerprint: item.fingerprint,
    attempt: item.attempt ?? 1,
    createdAt: item.createdAt,
    steps: item.steps,
    meta: item.meta,
    lastError: lastErrorStep?.error,
    file: 'file' in item ? item.file : undefined,
    intent: 'intent' in item ? (item as { intent?: Contracts.Intent.Any<M> }).intent : undefined,
    ...overrides,
  }
}

/** Default cap when `config.checksumMaxSize` is unset (`null`) or `0`: 64 MiB. */
export const DEFAULT_CHECKSUM_MAX_SIZE = 64 * 1024 * 1024

/**
 * Dedup set for one-time-per-session `console.info` notices, keyed by reason
 * string so each distinct notice fires once per JS realm.
 * @internal exported for tests.
 */
export const __checksumNoticesEmitted = new Set<string>()

/**
 * SHA-256 checksum of `file` for deduplication.
 *
 * When `file.size` exceeds the resolved cap the checksum is skipped and `null`
 * is returned, with no I/O performed on `file`. Hashing large files requires
 * reading the whole buffer into memory (Web Crypto has no incremental digest),
 * so the cap trades dedupe coverage for a hard memory ceiling. Operators that
 * need dedupe on large files should raise `checksumMaxSize` or compute
 * fingerprints out-of-band.
 *
 * Pass `maxSize = 0` or omit it to use {@link DEFAULT_CHECKSUM_MAX_SIZE}.
 *
 * @returns hex SHA-256 digest, or `null` when `file.size > cap`.
 */
export async function calculateFileChecksum(file: File, maxSize: number | null = null): Promise<string | null> {
  // Use the caller-supplied cap only when it's a finite positive number.
  // NaN / Infinity / 0 / negative all fall back to the conservative default.
  const cap =
    typeof maxSize === 'number' && Number.isFinite(maxSize) && maxSize > 0 ? maxSize : DEFAULT_CHECKSUM_MAX_SIZE
  if (file.size > cap) {
    if (!__checksumNoticesEmitted.has('skipped-oversize')) {
      __checksumNoticesEmitted.add('skipped-oversize')
      console.info(
        '[duck-upload] file exceeds checksumMaxSize; skipping checksum. ' +
          'Raise `checksumMaxSize` if dedupe coverage is required on large files.',
      )
    }
    return null
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolve auto-start config: `false | undefined` (never), `P[]` (in list), or
 * `(purpose) => boolean` predicate.
 */
export function isAutoStart<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(opts: Store.Options<M, C, P, R>, purpose: P): boolean {
  const v = opts.config?.autoStart
  if (v === undefined) return false
  if (Array.isArray(v)) return v.includes(purpose)
  if (typeof v === 'function') {
    // Fail-closed if the user-supplied predicate throws so a buggy
    // predicate can't stop the entire addFiles flow.
    try {
      return v(purpose) === true
    } catch {
      return false
    }
  }
  return false
}

/**
 * Lightweight `File` fingerprint for display/identity. For stronger identity
 * (SHA-256), pass {@link StoreOptions.fingerprint} or let add-file compute a
 * checksum asynchronously.
 */
export { computeFingerprint, fingerprintMatches }

/**
 * When `findByChecksum` matches, complete the item without creating an intent or
 * uploading bytes. Returns `true` when dedupe succeeded.
 */
export async function tryDedupeByChecksum<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(
  rt: Store.Runtime<M, C, P, R>,
  localId: string,
  checksum: string | undefined,
  purpose: P,
  allowedPhases: ReadonlyArray<Engine.Phase>,
): Promise<boolean> {
  if (!checksum || !rt.opts.api.findByChecksum) return false

  const item = rt.state.items.get(localId)
  if (!item || !allowedPhases.includes(item.phase) || !item.file) return false

  try {
    const existingFile = await rt.opts.api.findByChecksum({ checksum, purpose }, {
      ...buildApiContext(item),
      file: item.file,
    } as Contracts.Api.FindByChecksumContext<P, M>)
    if (!existingFile) return false

    const current = rt.state.items.get(localId)
    if (!current || !allowedPhases.includes(current.phase)) return false

    rt.applyInternal({ type: 'dedupe.ok', localId, result: existingFile })
    return true
  } catch (err) {
    if (typeof window !== 'undefined' && process.env['NODE_ENV'] === 'development') {
      console.warn('[UploadEngine] Failed to check for existing file:', err)
    }
    return false
  }
}

/**
 * Detects when `createIntent` returned an existing file result instead of an
 * upload intent (e.g. backend matched checksum during plan-upload).
 */
export function parseCreateIntentDedupeResult<R extends Contracts.Result.Base>(response: unknown): R | null {
  if (!isRecord(response)) return null

  const strategy = response['strategy']
  const markedDedupe =
    response['dedupe'] === true ||
    response['existing'] === true ||
    response['skipUpload'] === true ||
    strategy === 'dedupe'

  if (!markedDedupe) return null

  const fileId =
    typeof response['fileId'] === 'string'
      ? response['fileId']
      : typeof response['id'] === 'string'
        ? response['id']
        : null
  const key = typeof response['key'] === 'string' ? response['key'] : null
  if (!fileId || !key) return null

  return { fileId, key } as R
}

import {
  UploadAbortError,
  UploadEngineError,
  UploadHttpError,
  UploadNetworkError,
  UploadUnknownError,
} from '../../errors'

/**
 * Normalize a thrown value into an {@link Contracts.Errors.Error}. Override via
 * {@link StoreOptions.errorNormalizer}. Default: aborts → non-retryable;
 * network errors → retryable; HTTP 5xx/429 → retryable.
 */
export function normalizeError(err: unknown, customNormalizer?: (err: unknown) => Contracts.Errors.Error): UploadError {
  if (customNormalizer) return customNormalizer(err)

  if (err instanceof UploadEngineError) {
    return err
  }

  // Transport aborts carry `{ code: 'aborted', reason: 'pause' | 'cancel' }`.
  if (isAbortError(err)) {
    const reason = err.reason === 'pause' || err.reason === 'cancel' ? err.reason : 'unknown'
    return new UploadAbortError(reason, undefined, { cause: err })
  }

  const msg = isRecord(err) && typeof err['message'] === 'string' ? (err['message'] as string) : 'Unknown error'

  if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch')) {
    return new UploadNetworkError(msg, { cause: err })
  }

  if (isRecord(err) && (typeof err['status'] === 'number' || typeof err['statusCode'] === 'number')) {
    const status = (typeof err['status'] === 'number' ? err['status'] : err['statusCode']) as number
    const statusText = typeof err['statusText'] === 'string' ? err['statusText'] : undefined
    return new UploadHttpError(status, msg, { cause: err, statusText })
  }

  return new UploadUnknownError(msg, { cause: err })
}

/** Item has a concrete backend intent. */
export function hasIntent<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(item: Engine.Item<M, C, P, R>): item is Extract<Engine.Item<M, C, P, R>, { intent: M[keyof M] }> {
  return 'intent' in item && !!item.intent
}

/** Item has a bound `File`. Persisted items may lack it until the UI re-binds. */
export function hasFile<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(item: Engine.Item<M, C, P, R>): item is Extract<Engine.Item<M, C, P, R>, { file: File }> {
  return 'file' in item && !!item.file
}

/** Item variant carries a cursor field (depends on phase/strategy). */
export function hasCursor<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(item: Engine.Item<M, C, P, R>): item is Extract<Engine.Item<M, C, P, R>, { cursor?: Contracts.Cursor.Any<C> }> {
  return 'cursor' in item
}

/** Best-effort guard used to issue multipart-abort calls on cancel. */
export function isMultipartIntent(
  intent: unknown,
): intent is { strategy: 'multipart'; fileId: string; uploadId: string; partSize: number } {
  return (
    isRecord(intent) &&
    intent['strategy'] === 'multipart' &&
    typeof intent['fileId'] === 'string' &&
    typeof intent['uploadId'] === 'string'
  )
}

export function isAbortError(err: unknown): err is { code: 'aborted'; reason?: unknown } {
  return isRecord(err) && err['code'] === 'aborted'
}

/**
 * Decide whether to retry. Defers to `config.retryPolicy` when set.
 * Default: never retries `auth`/`validation_failed`/`strategy_missing`/`aborted`;
 * otherwise exponential backoff up to `maxAttempts`, capped at `DEFAULT_RETRY_DELAY_MAX_MS`.
 */
export function retryDecision<P extends string>(
  config: Engine.Config<P>,
  ctx: { phase: 'intent' | 'upload' | 'complete'; attempt: number; error: UploadError },
) {
  if (config.retryPolicy) return config.retryPolicy(ctx)

  if (ctx.error.code === 'auth') return { retryable: false }
  if (ctx.error.code === 'validation_failed') return { retryable: false }
  if (ctx.error.code === 'strategy_missing') return { retryable: false }
  if (ctx.error.code === 'aborted') return { retryable: false }

  const maxAttempts = config.maxAttempts
  const retryable = ctx.attempt < maxAttempts
  if (!retryable) return { retryable: false }

  const delayMs = Math.min(DEFAULT_RETRY_DELAY_MAX_MS, DEFAULT_RETRY_DELAY_BASE_MS * 2 ** (ctx.attempt - 1))
  return { retryable: true, delayMs }
}
