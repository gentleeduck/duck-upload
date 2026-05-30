import { afterEach, describe, expect, test } from 'vitest'
import { generateId } from '../core/utils/id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('generateId', () => {
  test('starts with the `upload_` prefix', () => {
    expect(generateId()).toMatch(/^upload_/)
  })

  test('embeds a v4 UUID after the timestamp', () => {
    const id = generateId()
    const match = id.match(/^upload_(\d+)_(.+)$/)
    expect(match).not.toBeNull()
    expect(match![2]).toMatch(UUID_V4)
  })

  test('produces 1000 unique IDs (collision-resistance smoke)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(generateId())
    expect(set.size).toBe(1000)
  })

  test('produces unique values across many calls', () => {
    const set = new Set<string>()
    for (let i = 0; i < 10_000; i++) set.add(generateId())
    expect(set.size).toBe(10_000)
  })
})

describe('generateId — fallback path (no crypto.randomUUID)', () => {
  const originalCrypto = (globalThis as { crypto?: Crypto }).crypto

  afterEach(() => {
    // Restore the original crypto reference for subsequent tests.
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    })
  })

  test('falls back to getRandomValues and still produces a v4-shaped UUID', () => {
    const fakeCrypto = {
      // Simulate a runtime that lacks randomUUID but has getRandomValues.
      getRandomValues: (arr: Uint8Array) => originalCrypto!.getRandomValues(arr),
    } as unknown as Crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: fakeCrypto,
      configurable: true,
      writable: true,
    })
    const id = generateId()
    const match = id.match(/^upload_\d+_(.+)$/)
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(UUID_V4)
  })

  test('throws when neither randomUUID nor getRandomValues are available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {} as Crypto,
      configurable: true,
      writable: true,
    })
    expect(() => generateId()).toThrow(/CSPRNG/)
  })
})
