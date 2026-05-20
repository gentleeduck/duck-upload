/**
 * SEC-002 — defense against prototype-pollution via persisted snapshots.
 * The legacy round-trip tests live in `src/__test__/persistence.test.ts`;
 * this file is scoped to security regressions.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isRecord } from '../../utils/guards'
import { LocalStorageAdapter } from '../adapters.local'

type LocalStorageStub = {
  store: Record<string, string>
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function installLocalStorageStub(): LocalStorageStub {
  const stub: LocalStorageStub = {
    store: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null
    },
    setItem(key, value) {
      this.store[key] = String(value)
    },
    removeItem(key) {
      delete this.store[key]
    },
    clear() {
      this.store = {}
    },
  }
  ;(globalThis as unknown as { localStorage: LocalStorageStub }).localStorage = stub
  return stub
}

describe('LocalStorageAdapter — SEC-002 prototype-pollution defense', () => {
  let stub: LocalStorageStub

  beforeEach(() => {
    stub = installLocalStorageStub()
  })

  afterEach(() => {
    // Defensive cleanup in case a test forgot to.
    delete (Object.prototype as Record<string, unknown>).polluted
    delete (Object.prototype as Record<string, unknown>).rce
  })

  test('a {"__proto__":{"polluted":true}} payload does NOT pollute Object.prototype after load', async () => {
    stub.store.snap = '{"__proto__":{"polluted":true}}'
    const loaded = await LocalStorageAdapter.load('snap')
    expect(loaded).not.toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(loaded as object, '__proto__')).toBe(false)
  })

  test('a {"constructor":{"prototype":{"polluted":true}}} payload does NOT pollute', async () => {
    stub.store.snap = '{"constructor":{"prototype":{"rce":true}}}'
    const loaded = await LocalStorageAdapter.load('snap')
    expect(loaded).not.toBeNull()
    expect(({} as Record<string, unknown>).rce).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(loaded as object, 'constructor')).toBe(false)
  })

  test('array-shaped persisted value is rejected by isRecord (no spread into state)', async () => {
    stub.store.snap = '[1,2,3]'
    const loaded = await LocalStorageAdapter.load('snap')
    expect(Array.isArray(loaded)).toBe(true)
    expect(isRecord(loaded)).toBe(false)
  })

  test('happy path: a plain-object snapshot hydrates fine', async () => {
    stub.store.snap = JSON.stringify({ version: 1, createdAt: 100, items: { x: { id: 'x', v: 1 } } })
    const loaded = (await LocalStorageAdapter.load('snap')) as Record<string, unknown>
    expect(loaded).toEqual({ version: 1, createdAt: 100, items: { x: { id: 'x', v: 1 } } })
    expect(isRecord(loaded)).toBe(true)
  })

  test('malformed JSON returns null', async () => {
    stub.store.snap = '{not-json'
    expect(await LocalStorageAdapter.load('snap')).toBeNull()
  })
})
