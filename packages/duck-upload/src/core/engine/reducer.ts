import type { Contracts } from '../contracts'
import { UploadValidationError } from '../errors'
import { computeFingerprint, fingerprintMatches } from '../utils/fingerprint'
import type { Engine } from './engine.types'

function stripError(err: { code: string; message: string; retryable?: boolean }): Contracts.StepError {
  const result: Contracts.StepError = { code: err.code, message: err.message }
  if (err.retryable !== undefined) result.retryable = err.retryable
  return result
}

function closeStep(steps: Contracts.UploadStep[], leftAt: number): Contracts.UploadStep[] {
  if (!steps.length) return steps
  const last = steps[steps.length - 1]
  if (!last || last.leftAt !== undefined) return steps
  const closed: Contracts.UploadStep = {
    phase: last.phase,
    enteredAt: last.enteredAt,
    leftAt,
    attempt: last.attempt,
    ...(last.error !== undefined ? { error: last.error } : {}),
  }
  return [...steps.slice(0, -1), closed]
}

function openStep(
  steps: Contracts.UploadStep[],
  phase: string,
  attempt: number,
  enteredAt: number,
  error?: Contracts.StepError,
): Contracts.UploadStep[] {
  return [...closeStep(steps, enteredAt), { phase, enteredAt, attempt, error }]
}

export function createReducer<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>() {
  return function reduce(
    state: Engine.State<M, C, P, R>,
    event: Engine.Command<P> | Engine.Event<M, C, P, R>,
  ): Engine.State<M, C, P, R> {
    const items = new Map(state.items)

    const set = (localId: string, next: Engine.Item<M, C, P, R>) => items.set(localId, next)

    const now = Date.now()

    // Commands have no dots in their `type`; internal events do (e.g. 'intent.ok').
    const isCommand = (e: Engine.Command<P> | Engine.Event<M, C, P, R>): e is Engine.Command<P> => {
      return 'type' in e && typeof e.type === 'string' && !e.type.includes('.')
    }

    if (isCommand(event)) {
      switch (event.type) {
        case 'addFiles': {
          // handled in store (creates items + emits events)
          break
        }

        case 'start': {
          const item = items.get(event.localId)
          if (!item) break
          if (item.phase !== 'ready') break

          set(event.localId, {
            ...item,
            phase: 'queued',
            requestedAt: now,
            steps: openStep(item.steps, 'queued', item.attempt ?? 1, now),
          })
          break
        }

        case 'resume': {
          const item = items.get(event.localId)
          if (!item) break
          if (item.phase !== 'paused') break
          if (!item.file) break

          set(event.localId, {
            ...item,
            file: item.file,
            phase: 'queued',
            requestedAt: now,
            steps: openStep(item.steps, 'queued', item.attempt ?? 1, now),
          })
          break
        }

        case 'pause': {
          const item = items.get(event.localId)
          if (!item) break

          // Queued-but-not-started: revert to ready. Uploading: store aborts and
          // emits 'paused' internally to move the item.
          if (item.phase === 'queued') {
            set(event.localId, {
              ...item,
              phase: 'ready',
              steps: openStep(item.steps, 'ready', item.attempt ?? 1, now),
            })
          }
          break
        }

        case 'cancel': {
          const item = items.get(event.localId)
          if (!item) break
          if (item.phase === 'completed' || item.phase === 'canceled') break

          set(event.localId, toCanceled(item, now))
          break
        }

        case 'retry': {
          const item = items.get(event.localId)
          if (!item) break
          if (item.phase !== 'error' || !item.retryable) break
          if (!item.file) break

          if (item.intent) {
            // Progress at 100% with intent means we failed in 'completing'  retry that phase.
            if (item.progress && item.progress.pct === 100) {
              set(event.localId, {
                ...item,
                progress: item.progress,
                intent: item.intent,
                file: item.file,
                phase: 'completing',
                completingAt: now,
                steps: openStep(item.steps, 'completing', item.attempt ?? 1, now),
              })
            } else {
              set(event.localId, {
                ...item,
                file: item.file,
                intent: item.intent,
                phase: 'ready',
                steps: openStep(item.steps, 'ready', item.attempt ?? 1, now),
              })
            }
          } else {
            // Intent-creation failure path; bump attempt counter.
            const nextAttempt = (item.attempt ?? 1) + 1
            set(event.localId, {
              ...item,
              phase: 'creating_intent',
              file: item.file,
              attempt: nextAttempt,
              steps: openStep(item.steps, 'creating_intent', nextAttempt, now),
            })
          }
          break
        }

        case 'rebind': {
          const item = items.get(event.localId)
          if (!item) break

          if (item.phase === 'paused' && !item.file) {
            const fp = computeFingerprint(event.file)
            if (fingerprintMatches(fp, item.fingerprint)) {
              set(event.localId, { ...item, file: event.file })
            }
          }
          break
        }

        case 'remove': {
          items.delete(event.localId)
          break
        }

        case 'startAll':
        case 'pauseAll':
        case 'cancelAll': {
          // handled in store
          break
        }
      }

      return { items }
    }

    switch (event.type) {
      case 'files.added': {
        const ev = event
        for (const item of ev.items) {
          if (!items.has(item.localId)) {
            set(item.localId, {
              phase: 'validating',
              localId: item.localId,
              purpose: item.purpose,
              file: item.file,
              fingerprint: item.fingerprint,
              createdAt: item.createdAt,
              meta: item.meta,
              steps: [{ phase: 'validating', enteredAt: now, attempt: 1 }],
            })
          }
        }
        break
      }

      case 'fingerprint.updated': {
        const ev = event
        const item = items.get(ev.localId)
        if (!item) break

        set(ev.localId, { ...item, fingerprint: ev.fingerprint })
        break
      }

      case 'validation.ok': {
        const item = items.get(event.localId)
        if (item?.phase !== 'validating') break

        set(event.localId, {
          ...item,
          phase: 'creating_intent',
          attempt: 1,
          steps: openStep(item.steps, 'creating_intent', 1, now),
        })
        break
      }

      case 'validation.failed': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'validating') break

        const err = new UploadValidationError(ev.reason)
        set(ev.localId, {
          ...item,
          phase: 'error',
          error: err,
          retryable: false,
          attempt: 1,
          failedAt: now,
          steps: openStep(item.steps, 'error', 1, now, stripError(err)),
        })
        break
      }

      case 'intent.ok': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'creating_intent') break

        set(ev.localId, {
          ...item,
          phase: 'ready',
          intent: ev.intent,
          steps: openStep(item.steps, 'ready', item.attempt ?? 1, now),
        })
        break
      }

      case 'intent.failed': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'creating_intent') break

        set(ev.localId, {
          ...item,
          phase: 'error',
          error: ev.error,
          retryable: ev.retryable,
          failedAt: now,
          steps: openStep(item.steps, 'error', item.attempt ?? 1, now, stripError(ev.error)),
        })
        break
      }

      case 'upload.begin': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'queued') break

        const total = item.file.size
        const carried: Engine.Progress | undefined = item.progress

        const progress: Engine.Progress = carried
          ? { ...carried, totalBytes: total, pct: pct(carried.uploadedBytes, total) }
          : { uploadedBytes: 0, totalBytes: total, pct: 0 }

        set(ev.localId, {
          ...item,
          phase: 'uploading',
          progress,
          startedAt: ev.startedAt,
          steps: openStep(item.steps, 'uploading', item.attempt ?? 1, ev.startedAt),
        })
        break
      }

      case 'upload.progress': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'uploading') break

        const progress: Engine.Progress = {
          uploadedBytes: ev.uploadedBytes,
          totalBytes: ev.totalBytes,
          pct: pct(ev.uploadedBytes, ev.totalBytes),
        }

        set(ev.localId, { ...item, progress })
        break
      }

      case 'cursor.updated': {
        const ev = event
        const item = items.get(ev.localId)
        if (!item) break

        if (item.phase === 'uploading') {
          set(ev.localId, { ...item, cursor: ev.cursor })
        } else if (item.phase === 'queued') {
          set(ev.localId, { ...item, cursor: ev.cursor })
        } else if (item.phase === 'paused') {
          set(ev.localId, { ...item, cursor: ev.cursor })
        }
        break
      }

      case 'upload.ok': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'uploading') break

        set(ev.localId, {
          ...item,
          phase: 'completing',
          progress: { uploadedBytes: item.file.size, totalBytes: item.file.size, pct: 100 },
          completingAt: now,
          steps: openStep(item.steps, 'completing', item.attempt ?? 1, now),
        })
        break
      }

      case 'upload.failed': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'uploading') break

        set(ev.localId, {
          ...item,
          phase: 'error',
          error: ev.error,
          retryable: ev.retryable,
          attempt: 1,
          failedAt: now,
          steps: openStep(item.steps, 'error', item.attempt ?? 1, now, stripError(ev.error)),
        })
        break
      }

      case 'paused': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'uploading') break

        set(ev.localId, {
          ...item,
          phase: 'paused',
          cursor: ev.cursor,
          pausedAt: ev.pausedAt,
          steps: openStep(item.steps, 'paused', item.attempt ?? 1, ev.pausedAt),
        })
        break
      }

      case 'canceled': {
        const ev = event
        const item = items.get(ev.localId)
        if (!item) break

        set(ev.localId, toCanceled(item, ev.canceledAt))
        break
      }

      case 'complete.ok': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'completing') break

        set(ev.localId, {
          ...item,
          phase: 'completed',
          completedBy: 'upload',
          result: ev.result,
          completedAt: now,
          steps: openStep(item.steps, 'completed', item.attempt ?? 1, now),
        })
        break
      }

      case 'dedupe.ok': {
        const ev = event
        const item = items.get(ev.localId)
        if (!item || (item.phase !== 'validating' && item.phase !== 'creating_intent')) break

        set(ev.localId, {
          phase: 'completed',
          localId: item.localId,
          file: 'file' in item ? item.file : undefined,
          purpose: item.purpose,
          fingerprint: item.fingerprint,
          result: ev.result,
          completedBy: 'dedupe',
          completedAt: now,
          createdAt: item.createdAt,
          meta: item.meta,
          steps: openStep(item.steps, 'completed', item.attempt ?? 1, now),
        })
        break
      }

      case 'complete.failed': {
        const ev = event
        const item = items.get(ev.localId)
        if (item?.phase !== 'completing') break

        const nextAttempt = (item.attempt ?? 1) + 1

        set(ev.localId, {
          ...item,
          phase: 'error',
          error: ev.error,
          retryable: ev.retryable,
          attempt: nextAttempt,
          failedAt: now,
          steps: openStep(item.steps, 'error', nextAttempt, now, stripError(ev.error)),
        })
        break
      }
    }

    return { items }
  }
}

function toCanceled<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(item: Engine.Item<M, C, P, R>, canceledAt: number): Engine.Item<M, C, P, R> {
  const attempt = ('attempt' in item ? item.attempt : undefined) ?? 1
  return {
    phase: 'canceled',
    localId: item.localId,
    purpose: item.purpose,
    fingerprint: item.fingerprint,
    canceledAt,
    createdAt: item.createdAt,
    file: 'file' in item ? item.file : undefined,
    intent: 'intent' in item ? item.intent : undefined,
    cursor: 'cursor' in item ? item.cursor : undefined,
    progress: 'progress' in item ? item.progress : undefined,
    attempt: 'attempt' in item ? item.attempt : undefined,
    meta: item.meta,
    steps: openStep(item.steps, 'canceled', attempt, canceledAt),
  }
}

function pct(uploaded: number, total: number) {
  if (total <= 0) return 0
  return Math.min(100, (uploaded / total) * 100)
}
