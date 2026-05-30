import type { CursorMap, IntentMap, UploadError, UploadResultBase } from '../../../contracts'
import { hasIntent, normalizeError, retryDecision, sleep } from '../store.libs'
import type { StoreRuntime } from '../store.types'

function hasContext(e: UploadError): e is UploadError & { context: Record<string, unknown> } {
  return typeof e === 'object' && e !== null && 'context' in e && typeof e.context === 'object' && e.context !== null
}

export async function finalizeUpload<
  M extends IntentMap,
  C extends CursorMap<M>,
  P extends string,
  R extends UploadResultBase,
>(rt: StoreRuntime<M, C, P, R>, localId: string) {
  const item = rt.state.items.get(localId)
  if (!item || item.phase !== 'completing') return
  if (rt.inflightCompletes.has(localId)) return

  const controller = new AbortController()
  rt.inflightCompletes.set(localId, controller)

  try {
    // Final commit step (backend should verify upload, then mark/commit it).
    // Strategy-specific API calls (multipart/tus) must happen inside the strategy itself.
    const result = await rt.opts.api.complete({ fileId: item.intent.fileId }, { signal: controller.signal })
    rt.inflightCompletes.delete(localId)

    // Item might have been canceled
    const current = rt.state.items.get(localId)
    if (!current || current.phase !== 'completing') return

    rt.applyInternal({ type: 'complete.ok', localId, result })
  } catch (err: unknown) {
    rt.inflightCompletes.delete(localId)

    if (controller.signal.aborted) return

    const error = normalizeError(err, rt.opts.errorNormalizer)

    const itemForContext = rt.state.items.get(localId)
    // SEC-003: do not interpolate the attacker-controlled filename / fileId
    // into the `message`. Surface them via the structured `context` field;
    // consumers MUST escape `context.*` before HTML rendering.
    const errorWithContext: UploadError = itemForContext
      ? {
          ...error,
          context: {
            ...(hasContext(error) ? error.context : {}),
            filename: itemForContext.fingerprint.name,
            fileId: (hasIntent(itemForContext) && itemForContext.intent?.fileId) ?? 'unknown',
          },
        }
      : error

    // Use actual attempt number from item state, defaulting to 1
    const attempt = itemForContext && 'attempt' in itemForContext ? (itemForContext.attempt ?? 1) : 1
    const decision = retryDecision(rt.opts.config, { phase: 'complete', attempt, error: errorWithContext })

    rt.applyInternal({ type: 'complete.failed', localId, error: errorWithContext, retryable: decision.retryable })

    if (decision.retryable && decision.delayMs !== undefined) {
      rt.enqueueEffect(async () => {
        await sleep(decision.delayMs)
        rt.dispatch({ type: 'retry', localId })
      })
    }
  }
}
