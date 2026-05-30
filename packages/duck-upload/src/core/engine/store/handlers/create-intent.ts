import type { AnyIntent, CursorMap, IntentMap, UploadError, UploadResultBase } from '../../../contracts'
import { sanitizeFilename } from '../../../utils/sanitize-filename'
import { validateIntent } from '../../validation'
import { normalizeError, retryDecision, sleep } from '../store.libs'
import type { StoreRuntime } from '../store.types'

export async function createIntent<
  M extends IntentMap,
  C extends CursorMap<M>,
  P extends string,
  R extends UploadResultBase,
>(rt: StoreRuntime<M, C, P, R>, localId: string) {
  const item = rt.state.items.get(localId)
  if (!item || item.phase !== 'creating_intent') return
  if (rt.inflightIntents.has(localId)) return

  // SEC-005: sanitise the filename before it leaves the engine. The
  // raw `file.name` may contain control chars, RTL overrides, reserved
  // Windows names, etc. - see `sanitizeFilename` for the full pipeline.
  const sanitised = sanitizeFilename(item.file.name)
  if (!sanitised.safe) {
    const error: UploadError = {
      code: 'validation_failed',
      message: 'filename rejected',
      reason: { code: 'filename_rejected', reason: sanitised.reason },
      retryable: false,
      // Tainted original lives only on `context` (SEC-003 contract).
      context: { original: item.file.name, reason: sanitised.reason },
    }
    rt.applyInternal({ type: 'intent.failed', localId, error, retryable: false })
    return
  }

  const controller = new AbortController()
  rt.inflightIntents.set(localId, controller)

  try {
    const intent = await rt.opts.api.createIntent(
      {
        purpose: item.purpose,
        contentType: item.file.type || 'application/octet-stream',
        size: item.file.size,
        filename: sanitised.normalised,
        checksum: item.fingerprint.checksum,
      },
      { signal: controller.signal },
    )

    rt.inflightIntents.delete(localId)

    // Item might have been canceled while intent was creating
    const current = rt.state.items.get(localId)
    if (!current || current.phase !== 'creating_intent') return

    // Validate intent from backend
    const intentError = validateIntent(intent, intent.strategy)
    if (intentError) {
      const error: UploadError = {
        code: 'validation_failed',
        message: `Invalid intent from backend: ${intentError.message}`,
        cause: intentError,
        retryable: false,
      }
      rt.applyInternal({ type: 'intent.failed', localId, error, retryable: false })
      return
    }

    rt.applyInternal({ type: 'intent.ok', localId, intent: intent as AnyIntent<M> })
  } catch (err: unknown) {
    rt.inflightIntents.delete(localId)

    if (controller.signal.aborted) {
      // canceled
      return
    }

    const error = normalizeError(err, rt.opts.errorNormalizer)
    // SEC-003: do NOT interpolate the attacker-controlled filename into the
    // human-readable `message`. Place it on a structured `context` field;
    // consumers MUST escape `context.*` before any HTML rendering.
    const errorWithContext: UploadError = {
      ...error,
      context: {
        ...((error as { context?: Record<string, unknown> }).context ?? {}),
        filename: item.fingerprint.name,
        size: item.file.size,
        purpose: item.purpose,
      },
    }

    const decision = retryDecision(rt.opts.config, { phase: 'intent', attempt: item.attempt, error: errorWithContext })

    rt.applyInternal({ type: 'intent.failed', localId, error: errorWithContext, retryable: decision.retryable })

    if (decision.retryable && decision.delayMs !== undefined) {
      rt.enqueueEffect(async () => {
        await sleep(decision.delayMs)
        rt.dispatch({ type: 'retry', localId })
      })
    }
  }
}
