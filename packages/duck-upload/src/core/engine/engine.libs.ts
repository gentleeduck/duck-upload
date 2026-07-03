import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT_UPLOADS,
  DEFAULT_MAX_ITEMS,
  DEFAULT_PROGRESS_THROTTLE_MS,
} from '../utils/constants'
import type { Engine } from './engine.types'

/**
 * Clamp a numeric config field, rejecting non-finite values (NaN, Infinity)
 * that would otherwise slip past a plain `Math.max`.
 */
function finitePositive(input: number | undefined, fallback: number, min = 1): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(min, input)
}

/**
 * Normalizes user config by applying sensible defaults.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function resolveUploadConfig<P extends string>(input?: Partial<Engine.Config<P>>): Engine.Config<P> {
  return {
    maxConcurrentUploads: finitePositive(input?.maxConcurrentUploads, DEFAULT_MAX_CONCURRENT_UPLOADS),
    autoStart: input?.autoStart,
    progressThrottleMs: finitePositive(input?.progressThrottleMs, DEFAULT_PROGRESS_THROTTLE_MS, 0),
    validation: input?.validation ?? {},
    maxAttempts: finitePositive(input?.maxAttempts, DEFAULT_MAX_ATTEMPTS),
    retryPolicy: input?.retryPolicy,
    maxItems: finitePositive(input?.maxItems, DEFAULT_MAX_ITEMS),
    completedItemTTL: input?.completedItemTTL,
    strictMimeMatch: input?.strictMimeMatch ?? false,
    checksumMaxSize: input?.checksumMaxSize ?? null,
  }
}
