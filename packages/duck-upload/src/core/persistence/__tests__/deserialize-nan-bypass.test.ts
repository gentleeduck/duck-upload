/**
 * NaN-bypass defense for the persistence deserializer. A persisted
 * `size: NaN`, `lastModified: NaN`, `pct: NaN`, or negative byte count
 * would land in the deserialized state and break downstream math
 * (`uploadedBytes / totalBytes` → NaN, comparisons silently false).
 * Every numeric field must pass `Number.isFinite` + non-negative.
 */

import { describe, expect, test } from 'vitest'
import { deserializeSnapshot } from '../persistence'

function makeOpts(strategy = 'post') {
  return {
    isPurpose: (v: string): v is string => typeof v === 'string',
    isIntent: (v: unknown): v is { strategy: string } => typeof v === 'object' && v !== null && 'strategy' in v,
    hasStrategy: (v: string) => v === strategy,
  }
}

const okItem = {
  id: 'u1',
  purpose: 'avatar',
  status: 'paused',
  file: { name: 'a.txt', size: 100, type: 'text/plain', lastModified: 1700000000 },
  intent: { strategy: 'post', fileId: 'f' },
  cursor: { strategy: 'post' },
  progress: { uploadedBytes: 50, totalBytes: 100, pct: 50 },
}

describe('deserializeSnapshot - NaN-bypass defense', () => {
  test('NaN version rejects snapshot', () => {
    const raw = { version: Number.NaN, createdAt: 1, items: { u1: okItem } }
    expect(deserializeSnapshot(raw, makeOpts())).toBeNull()
  })

  test('Infinity createdAt rejects snapshot', () => {
    const raw = { version: 1, createdAt: Number.POSITIVE_INFINITY, items: { u1: okItem } }
    expect(deserializeSnapshot(raw, makeOpts())).toBeNull()
  })

  test('NaN file.size drops the item (other items still load)', () => {
    const raw = {
      version: 1,
      createdAt: 1,
      items: {
        u1: { ...okItem, file: { ...okItem.file, size: Number.NaN } },
        u2: { ...okItem, id: 'u2' },
      },
    }
    const state = deserializeSnapshot(raw, makeOpts())
    expect(state).not.toBeNull()
    expect(state?.items.has('u1')).toBe(false)
    expect(state?.items.has('u2')).toBe(true)
  })

  test('negative size drops the item', () => {
    const raw = {
      version: 1,
      createdAt: 1,
      items: { u1: { ...okItem, file: { ...okItem.file, size: -1 } } },
    }
    const state = deserializeSnapshot(raw, makeOpts())
    expect(state?.items.has('u1')).toBe(false)
  })

  test('NaN lastModified drops the item', () => {
    const raw = {
      version: 1,
      createdAt: 1,
      items: { u1: { ...okItem, file: { ...okItem.file, lastModified: Number.NaN } } },
    }
    const state = deserializeSnapshot(raw, makeOpts())
    expect(state?.items.has('u1')).toBe(false)
  })

  test('NaN progress.uploadedBytes drops progress (item still loads with zero)', () => {
    const raw = {
      version: 1,
      createdAt: 1,
      items: {
        u1: { ...okItem, progress: { ...okItem.progress, uploadedBytes: Number.NaN } },
      },
    }
    const state = deserializeSnapshot(raw, makeOpts())
    expect(state?.items.has('u1')).toBe(true)
    const item = state?.items.get('u1')
    expect(item?.progress.uploadedBytes).toBe(0)
  })

  test('empty MIME type is allowed (browsers may return empty for unknown)', () => {
    const raw = {
      version: 1,
      createdAt: 1,
      items: { u1: { ...okItem, file: { ...okItem.file, type: '' } } },
    }
    const state = deserializeSnapshot(raw, makeOpts())
    expect(state?.items.has('u1')).toBe(true)
  })
})
