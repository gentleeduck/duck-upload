import { describe, expect, test, vi } from 'vitest'
import { createUploadStore } from '../core/engine/store'
import { parseCreateIntentDedupeResult } from '../core/engine/store/store.libs'
import { PostStrategy } from '../strategies/post'
import { createStrategyRegistry } from '../strategies/registry'

type Intents = { post: PostStrategy.Intent }
type Cursors = { post?: PostStrategy.Cursor }
type Purpose = 'attachment'
type Result = { fileId: string; key: string }

const strategies = createStrategyRegistry<Intents, Cursors, Purpose>()
strategies.set(PostStrategy())

describe('parseCreateIntentDedupeResult', () => {
  test('accepts explicit dedupe markers with id + key', () => {
    expect(parseCreateIntentDedupeResult({ existing: true, id: 'f1', key: 'k1' })).toEqual({
      fileId: 'f1',
      key: 'k1',
    })
  })

  test('ignores normal upload intents', () => {
    expect(
      parseCreateIntentDedupeResult({
        strategy: 'post',
        fileId: 'f1',
        url: 'https://example.com',
        fields: {},
      }),
    ).toBeNull()
  })
})

describe('checksum dedupe', () => {
  test('skips createIntent when findByChecksum matches during validation', async () => {
    const createIntent = vi.fn()
    const findByChecksum = vi.fn(async () => ({ fileId: 'existing-1', key: 'perm/key' }))

    const store = createUploadStore<Intents, Cursors, Purpose, Result>({
      strategies,
      api: {
        createIntent,
        complete: vi.fn(),
        findByChecksum,
      },
      config: { autoStart: ['attachment'] },
    })

    const file = new File(['hello'], 'a.txt', { type: 'text/plain' })
    store.dispatch({ type: 'addFiles', files: [file], purpose: 'attachment' })

    await vi.waitFor(() => {
      const items = Array.from(store.getSnapshot().items.values())
      expect(items.some((item) => item.phase === 'completed')).toBe(true)
    })

    expect(findByChecksum).toHaveBeenCalled()
    expect(createIntent).not.toHaveBeenCalled()

    const completed = Array.from(store.getSnapshot().items.values()).find((item) => item.phase === 'completed')
    expect(completed && 'completedBy' in completed ? completed.completedBy : undefined).toBe('dedupe')
  })
})
