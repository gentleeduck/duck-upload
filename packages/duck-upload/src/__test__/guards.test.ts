import { describe, expect, test } from 'vitest'
import { isRecord } from '../core/utils/guards'

describe('isRecord', () => {
  test('plain object', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  test('null', () => {
    expect(isRecord(null)).toBe(false)
  })

  test('undefined', () => {
    expect(isRecord(undefined)).toBe(false)
  })

  test('primitives', () => {
    expect(isRecord(0)).toBe(false)
    expect(isRecord('a')).toBe(false)
    expect(isRecord(true)).toBe(false)
  })

  // SEC-002: isRecord now rejects arrays and other non-plain objects so that
  // hydrate paths cannot spread foreign shapes into runtime state.
  test('arrays are rejected', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2, 3])).toBe(false)
  })

  test('exotic objects are rejected', () => {
    expect(isRecord(new Date())).toBe(false)
    expect(isRecord(new Map())).toBe(false)
    expect(isRecord(new Set())).toBe(false)
    class Foo {}
    expect(isRecord(new Foo())).toBe(false)
  })

  test('null-prototype objects are accepted', () => {
    expect(isRecord(Object.create(null))).toBe(true)
  })
})
