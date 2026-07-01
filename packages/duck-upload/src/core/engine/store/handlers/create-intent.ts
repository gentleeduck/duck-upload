import type { Contracts } from '../../../contracts'
import type { UploadError } from '../../../errors'
import { UploadValidationError } from '../../../errors'
import { isRecord } from '../../../utils/guards'
import { sanitizeFilename } from '../../../utils/sanitize-filename'
import { validateIntent } from '../../validation'
import {
  buildApiContext,
  normalizeError,
  parseCreateIntentDedupeResult,
  retryDecision,
  sleep,
  tryDedupeByChecksum,
} from '../store.libs'
import type { Store } from '../store.types'

export async function createIntent<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(rt: Store.Runtime<M, C, P, R>, localId: string) {
  const item = rt.state.items.get(localId)
  if (item?.phase !== 'creating_intent') return
  if (rt.inflightIntents.has(localId)) return

  const sanitised = sanitizeFilename(item.file.name)
  if (!sanitised.safe) {
    const error = new UploadValidationError(
      { code: 'filename_rejected', reason: sanitised.reason },
      'filename rejected',
      { context: { original: item.file.name, reason: sanitised.reason } },
    )
    rt.applyInternal({
      type: 'intent.failed',
      localId,
      error,
      retryable: false,
    })
    return
  }

  const controller = new AbortController()
  rt.inflightIntents.set(localId, controller)

  try {
    if (await tryDedupeByChecksum(rt, localId, item.fingerprint.checksum, item.purpose, ['creating_intent'])) {
      return
    }

    const intentArgs: {
      purpose: P
      contentType: string
      size: number
      filename: string
      checksum?: string
      attempt: number
    } = {
      purpose: item.purpose,
      contentType: item.file.type || 'application/octet-stream',
      size: item.file.size,
      filename: sanitised.normalised,
      attempt: item.attempt ?? 1,
    }
    if (item.fingerprint.checksum !== undefined) {
      intentArgs.checksum = item.fingerprint.checksum
    }

    const intent = await rt.opts.api.createIntent(
      intentArgs,
      buildApiContext(item, { signal: controller.signal }) as Contracts.Api.CreateIntentContext<P, M>,
    )

    rt.inflightIntents.delete(localId)

    // Item might have been canceled while intent was creating
    const current = rt.state.items.get(localId)
    if (current?.phase !== 'creating_intent') return

    const dedupeResult = parseCreateIntentDedupeResult<R>(intent)
    if (dedupeResult) {
      rt.applyInternal({ type: 'dedupe.ok', localId, result: dedupeResult })
      return
    }

    // Validate intent from backend
    const strategy = isRecord(intent) && typeof intent.strategy === 'string' ? intent.strategy : ''
    const intentError = validateIntent(intent, strategy)
    if (intentError) {
      rt.applyInternal({
        type: 'intent.failed',
        localId,
        error: intentError,
        retryable: false,
      })
      return
    }

    rt.applyInternal({ type: 'intent.ok', localId, intent: intent as Contracts.Intent.Any<M> })
  } catch (err: unknown) {
    rt.inflightIntents.delete(localId)

    if (controller.signal.aborted) {
      // canceled
      return
    }

    const error = normalizeError(err, rt.opts.errorNormalizer)
    const errorWithContext: UploadError = {
      ...error,
      context: {
        ...((error as { context?: Record<string, unknown> }).context ?? {}),
        filename: item.fingerprint.name,
        size: item.file.size,
        purpose: item.purpose,
      },
    }

    const attempt = item.attempt ?? 1
    const decision = retryDecision(rt.opts.config, { phase: 'intent', attempt, error: errorWithContext })

    rt.applyInternal({ type: 'intent.failed', localId, error: errorWithContext, retryable: decision.retryable })

    if (decision.retryable && decision.delayMs !== undefined) {
      rt.enqueueEffect(async () => {
        await sleep(decision.delayMs)
        rt.dispatch({ type: 'retry', localId })
      })
    }
  }
}
