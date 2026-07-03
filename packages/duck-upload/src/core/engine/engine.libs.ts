import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT_UPLOADS,
  DEFAULT_MAX_ITEMS,
  DEFAULT_PROGRESS_THROTTLE_MS,
} from '../utils/constants'
import type { Engine } from './engine.types'

/**
 * Normalizes user config by applying sensible defaults.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function resolveUploadConfig<P extends string>(input?: Partial<Engine.Config<P>>): Engine.Config<P> {
  return {
    maxConcurrentUploads: Math.max(1, input?.maxConcurrentUploads ?? DEFAULT_MAX_CONCURRENT_UPLOADS),
    autoStart: input?.autoStart,
    progressThrottleMs: Math.max(0, input?.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS),
    validation: input?.validation ?? {},
    maxAttempts: Math.max(1, input?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    retryPolicy: input?.retryPolicy,
    maxItems: Math.max(1, input?.maxItems ?? DEFAULT_MAX_ITEMS),
    completedItemTTL: input?.completedItemTTL,
    strictMimeMatch: input?.strictMimeMatch ?? false,
    checksumMaxSize: input?.checksumMaxSize ?? null,
  }
}
