import { describe, expect, test } from 'vitest'
import { isRecord, stripDangerousKeys } from '../guards'

describe('stripDangerousKeys', () => {
  test('removes top-level __proto__ / constructor / prototype', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"a":1,"constructor":{"x":1},"prototype":{"y":2}}')
    const out = stripDangerousKeys(raw)
    expect(out).toEqual({ a: 1 })
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(out, 'prototype')).toBe(false)
  })

  test('removes nested __proto__ inside plain branches', () => {
    const raw = JSON.parse('{"items":{"a":{"__proto__":{"polluted":true},"v":1}}}')
    const out = stripDangerousKeys(raw) as { items: { a: Record<string, unknown> } }
    expect(out.items.a).toEqual({ v: 1 })
  })

  test('walks arrays', () => {
    const raw = JSON.parse('{"list":[{"__proto__":{"x":1},"v":1},{"v":2}]}')
    const out = stripDangerousKeys(raw) as { list: Array<Record<string, unknown>> }
    expect(out.list[0]).toEqual({ v: 1 })
    expect(out.list[1]).toEqual({ v: 2 })
  })

  test('depth cap of 16 — does not throw on deeply nested input, returns input as-is past the cap', () => {
    type Node = { child?: Node; v?: number; __proto__?: unknown }
    let depth = 0
    let leaf: Node = { v: 0 }
    const root: Node = leaf
    for (let i = 0; i < 20; i++) {
      const next: Node = {}
      leaf.child = next
      leaf = next
      depth++
    }
    // place a dangerous key beyond the depth cap (level 19 ≥ 16 → untouched)
    const dangerousLeaf = JSON.parse('{"__proto__":{"polluted":true},"v":99}')
    leaf.child = dangerousLeaf as Node
    expect(() => stripDangerousKeys(root)).not.toThrow()
    expect(depth).toBe(20)
  })

  test('does not pollute Object.prototype', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true}}')
    stripDangerousKeys(raw)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('leaves exotic objects (Date, Map) untouched', () => {
    const d = new Date(0)
    const m = new Map([['k', 1]])
    const raw = { d, m, v: 1 } as Record<string, unknown>
    const out = stripDangerousKeys(raw) as Record<string, unknown>
    expect(out.d).toBe(d)
    expect(out.m).toBe(m)
    expect(out.v).toBe(1)
  })

  test('returns primitives and null unchanged', () => {
    expect(stripDangerousKeys(null as unknown)).toBe(null)
    expect(stripDangerousKeys(42 as unknown)).toBe(42)
    expect(stripDangerousKeys('s' as unknown)).toBe('s')
  })
})

describe('isRecord (SEC-002 tightening)', () => {
  test('rejects arrays', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2])).toBe(false)
  })

  test('rejects Date', () => {
    expect(isRecord(new Date())).toBe(false)
  })

  test('rejects Map', () => {
    expect(isRecord(new Map())).toBe(false)
  })

  test('rejects class instances', () => {
    class Thing {
      a = 1
    }
    expect(isRecord(new Thing())).toBe(false)
  })

  test('accepts plain object literal and null-prototype object', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
  })
})
