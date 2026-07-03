import type { Contracts } from '../contracts'
import type { Engine } from '../engine/engine.types'
import { hasCursor, hasIntent } from '../engine/store/store.libs'
import { isRecord } from '../utils/guards'
import type { UploadPersistence } from './persistence.types'

/**
 * Serializes the current upload state into a JSON-safe structure.
 * Only serializes items that have a valid 'intent', as these are the only ones
 * that can be resumed cleanly.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function serializeSnapshot<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(state: Engine.State<M, C, P, R>, version: number): UploadPersistence.Snapshot<M, C, P> {
  const items: Record<string, UploadPersistence.PersistedItem<M, C, P>> = {}

  for (const item of state.items.values()) {
    if (!hasIntent(item)) continue

    // Do not persist terminal items. Persistence is for resuming and recovery, not history.
    const phase = item.phase as string
    if (phase === 'completed' || phase === 'canceled' || phase === 'error') {
      continue
    }

    const cursor = hasCursor(item) ? item.cursor : undefined

    const progress =
      'progress' in item && item.progress
        ? {
            uploadedBytes: item.progress.uploadedBytes,
            totalBytes: item.progress.totalBytes,
            pct: item.progress.pct,
          }
        : undefined

    const persisted: UploadPersistence.PersistedItem<M, C, P> = {
      id: item.localId,
      purpose: item.purpose,
      status: item.phase,
      file: {
        name: item.fingerprint.name,
        size: item.fingerprint.size,
        type: item.fingerprint.type,
        lastModified: item.fingerprint.lastModified,
        checksum: item.fingerprint.checksum,
      },
      intent: item.intent as Contracts.Intent.Any<M>,
      cursor,
      progress,
    }

    items[persisted.id] = persisted
  }

  return { version, createdAt: Date.now(), items }
}

/**
 * Deserializes a persisted snapshot back into a store state.
 *
 * Important:
 * - Browser `File` objects cannot be restored from persistence.
 * - We restore resumable items (those with a cursor) into the `paused` phase,
 *   with `file` left undefined. Your UI can ask the user to rebind the file.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function deserializeSnapshot<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(raw: unknown, opts: UploadPersistence.DeserializeContext<M, P>): Engine.State<M, C, P, R> | null {
  if (!opts.isPurpose || !opts.isIntent || !opts.hasStrategy) return null
  if (!isPersistedSnapshot(raw)) return null

  const items = new Map<string, Engine.Item<M, C, P, R>>()

  for (const value of Object.values(raw.items)) {
    const parsed = parsePersistedItem(value)
    if (!parsed) continue

    if (!opts.isPurpose(parsed.purpose)) continue
    if (!opts.isIntent(parsed.intent)) continue

    const intentObj = parsed.intent
    if (!isRecord(intentObj)) continue
    const strategy = intentObj.strategy
    if (typeof strategy !== 'string' || !opts.hasStrategy(strategy)) continue

    if (!parsed.cursor || !isCursorForRegistry<C>(parsed.cursor, opts.hasStrategy)) continue
    if (parsed.cursor.strategy !== strategy) continue

    const totalBytes = parsed.progress?.totalBytes ?? parsed.file.size
    const uploadedBytes = parsed.progress?.uploadedBytes ?? 0
    const pct =
      typeof parsed.progress?.pct === 'number'
        ? parsed.progress.pct
        : totalBytes > 0
          ? Math.min(100, Math.max(0, (uploadedBytes / totalBytes) * 100))
          : 0

    items.set(parsed.id, {
      phase: 'paused',
      localId: parsed.id,
      purpose: parsed.purpose as P,
      fingerprint: {
        name: parsed.file.name,
        size: parsed.file.size,
        type: parsed.file.type,
        lastModified: parsed.file.lastModified,
        checksum: parsed.file.checksum,
      },
      intent: parsed.intent as Contracts.Intent.Any<M>,
      cursor: parsed.cursor,
      progress: { uploadedBytes, totalBytes, pct },
      pausedAt: Date.now(),
      createdAt: raw.createdAt ?? Date.now(),
      file: undefined,
      steps: [],
      meta: {},
    } as Engine.Item<M, C, P, R>)
  }

  return { items }
}

function isPersistedSnapshot(
  value: unknown,
): value is UploadPersistence.Snapshot<Contracts.Intent.Map, Contracts.Cursor.Map<Contracts.Intent.Map>, string> {
  if (!isRecord(value)) return false
  if (typeof value['version'] !== 'number') return false
  if (typeof value['createdAt'] !== 'number') return false
  return isRecord(value['items'])
}

function parsePersistedItem(value: unknown): {
  id: string
  purpose: string
  status: string
  file: { name: string; size: number; type: string; lastModified: number; checksum?: string | undefined }
  intent: unknown
  cursor?: Contracts.Cursor.Any<Contracts.Cursor.Map<Contracts.Intent.Map>> | undefined
  progress?: { uploadedBytes: number; totalBytes: number; pct?: number | undefined } | undefined
} | null {
  if (!isRecord(value)) return null

  const id = typeof value['id'] === 'string' ? value['id'] : null
  const purpose = typeof value['purpose'] === 'string' ? value['purpose'] : null
  const status = typeof value['status'] === 'string' ? value['status'] : null
  const intent = value['intent']

  if (!id || !purpose || !status) return null

  const fileObj = value['file']
  if (!isRecord(fileObj)) return null

  const name = typeof fileObj['name'] === 'string' ? fileObj['name'] : null
  const size = typeof fileObj['size'] === 'number' ? fileObj['size'] : null
  const type = typeof fileObj['type'] === 'string' ? fileObj['type'] : null
  const lastModified = typeof fileObj['lastModified'] === 'number' ? fileObj['lastModified'] : null
  const checksum = typeof fileObj['checksum'] === 'string' ? fileObj['checksum'] : undefined

  if (!name || size === null || !type || lastModified === null) return null

  const progress = parseProgress(value['progress'])
  const cursor = value['cursor'] as Contracts.Cursor.Any<Contracts.Cursor.Map<Contracts.Intent.Map>> | undefined

  return {
    id,
    purpose,
    status,
    file: { name, size, type, lastModified, checksum },
    intent,
    cursor,
    progress,
  }
}

function parseProgress(
  value: unknown,
): { uploadedBytes: number; totalBytes: number; pct?: number | undefined } | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value['uploadedBytes'] !== 'number' || typeof value['totalBytes'] !== 'number') return undefined
  const pct = typeof value['pct'] === 'number' ? value['pct'] : undefined
  return { uploadedBytes: value['uploadedBytes'] as number, totalBytes: value['totalBytes'] as number, pct }
}

function isCursorForRegistry<C extends Record<string, unknown>>(
  value: unknown,
  hasStrategy: (value: string) => boolean,
): value is Contracts.Cursor.Any<C> {
  if (!isRecord(value)) return false
  const strategy = value['strategy']
  if (typeof strategy !== 'string') return false
  if (!hasStrategy(strategy)) return false
  return true
}
