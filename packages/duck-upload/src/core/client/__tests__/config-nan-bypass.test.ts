import { describe, expect, test } from 'vitest'
import { resolveUploadConfig } from '../config.types'

describe('resolveUploadConfig - NaN-bypass defense', () => {
  test('NaN maxAttempts falls back to default (does NOT propagate NaN)', () => {
    const cfg = resolveUploadConfig({ maxAttempts: Number.NaN })
    expect(Number.isFinite(cfg.maxAttempts)).toBe(true)
    expect(cfg.maxAttempts).toBeGreaterThanOrEqual(1)
  })

  test('Infinity maxAttempts falls back to default (no infinite retry loop)', () => {
    const cfg = resolveUploadConfig({ maxAttempts: Number.POSITIVE_INFINITY })
    expect(Number.isFinite(cfg.maxAttempts)).toBe(true)
  })

  test('NaN maxConcurrentUploads falls back', () => {
    const cfg = resolveUploadConfig({ maxConcurrentUploads: Number.NaN })
    expect(Number.isFinite(cfg.maxConcurrentUploads)).toBe(true)
  })

  test('Infinity progressThrottleMs falls back (no scheduler wedge)', () => {
    const cfg = resolveUploadConfig({ progressThrottleMs: Number.POSITIVE_INFINITY })
    expect(Number.isFinite(cfg.progressThrottleMs)).toBe(true)
  })

  test('NaN maxItems falls back', () => {
    const cfg = resolveUploadConfig({ maxItems: Number.NaN })
    expect(Number.isFinite(cfg.maxItems)).toBe(true)
  })

  test('negative maxAttempts clamps to 1', () => {
    const cfg = resolveUploadConfig({ maxAttempts: -5 })
    expect(cfg.maxAttempts).toBe(1)
  })

  test('finite positive maxAttempts is preserved', () => {
    const cfg = resolveUploadConfig({ maxAttempts: 7 })
    expect(cfg.maxAttempts).toBe(7)
  })
})
