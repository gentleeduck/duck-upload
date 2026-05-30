import type { UploadError, UploadValidationRules } from '../contracts'
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT_UPLOADS,
  DEFAULT_MAX_ITEMS,
  DEFAULT_PROGRESS_THROTTLE_MS,
} from '../utils/constants'
import type { RetryDecision } from './retry.types'

/**
 * Global upload engine configuration.
 *
 * @typeParam P - Union of allowed `purpose` strings for your app.
 */
export type UploadConfig<P extends string> = {
  /** Maximum concurrent uploads. */
  maxConcurrentUploads: number

  /**
   * Auto-start uploads for specific purposes.
   * - Array form: only those purposes auto-start
   * - Function form: dynamic decision per purpose
   */
  autoStart?: readonly P[] | ((purpose: P) => boolean)

  /** Progress event throttle in milliseconds. */
  progressThrottleMs: number

  /** Validation rules keyed by purpose. */
  validation: Partial<Record<P, UploadValidationRules>>

  /** Maximum number of retry attempts (per item / per phase depending on implementation). */
  maxAttempts: number

  /**
   * Retry policy.
   * Called whenever a phase fails and the engine needs a decision.
   */
  retryPolicy?: (ctx: { phase: 'intent' | 'upload' | 'complete'; attempt: number; error: UploadError }) => RetryDecision

  /**
   * Maximum number of items to keep in state.
   * When exceeded, oldest completed/canceled items are removed automatically.
   *
   * Set to `undefined` for no limit (not recommended for long-running apps).
   * Default often: `100`.
   */
  maxItems: number

  /**
   * Automatically remove completed items after this many milliseconds.
   * Set to `undefined` to keep completed items indefinitely.
   */
  completedItemTTL?: number
}

/**
 * Config input shape accepted by store creation.
 * All fields are optional; defaults are applied by {@link resolveUploadConfig}.
 */
export type UploadConfigInput<P extends string> = Partial<UploadConfig<P>>

/** Normalizes user config by applying sensible defaults. */
function finitePositive(input: number | undefined, fallback: number, min = 1): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(min, input)
}

export function resolveUploadConfig<P extends string>(input?: UploadConfigInput<P>): UploadConfig<P> {
  return {
    maxConcurrentUploads: finitePositive(input?.maxConcurrentUploads, DEFAULT_MAX_CONCURRENT_UPLOADS),
    autoStart: input?.autoStart,
    progressThrottleMs: finitePositive(input?.progressThrottleMs, DEFAULT_PROGRESS_THROTTLE_MS, 0),
    validation: input?.validation ?? {},
    maxAttempts: finitePositive(input?.maxAttempts, DEFAULT_MAX_ATTEMPTS),
    retryPolicy: input?.retryPolicy,
    maxItems: finitePositive(input?.maxItems, DEFAULT_MAX_ITEMS),
    completedItemTTL: input?.completedItemTTL,
  }
}
