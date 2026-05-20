import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveUploadConfig } from '../core/client'
import {
  __checksumNoticesEmitted,
  calculateFileChecksum,
  isAbortError,
  isMultipartIntent,
  normalizeError,
  retryDecision,
} from '../core/engine/store/store.libs'

describe('normalizeError', () => {
  test('honors a custom normalizer', () => {
    const err = normalizeError('anything', () => ({ code: 'auth', message: 'no', retryable: false }))
    expect(err.code).toBe('auth')
  })

  test('classifies abort-shaped errors as aborted/non-retryable', () => {
    const err = normalizeError({ code: 'aborted', reason: 'cancel' })
    expect(err.code).toBe('aborted')
    expect(err.retryable).toBe(false)
  })

  test('thrown value with statusCode alias classifies as http', () => {
    const err = normalizeError({ statusCode: 503, message: 'down' })
    expect(err.code).toBe('http')
    expect((err as { status?: number }).status).toBe(503)
    expect(err.retryable).toBe(true)
  })

  test('http 5xx is retryable', () => {
    const err = normalizeError({ status: 503, message: 'down' })
    expect(err.code).toBe('http')
    expect(err.retryable).toBe(true)
  })

  test('http 429 is retryable', () => {
    const err = normalizeError({ status: 429, message: 'slow down' })
    expect(err.code).toBe('http')
    expect(err.retryable).toBe(true)
  })

  test('http 400 is not retryable', () => {
    const err = normalizeError({ status: 400, message: 'bad' })
    expect(err.code).toBe('http')
    expect(err.retryable).toBe(false)
  })

  test('falls back to unknown non-retryable', () => {
    const err = normalizeError({})
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
  })
})

describe('retryDecision', () => {
  const config = resolveUploadConfig({ maxAttempts: 3 })

  test('auth errors never retry', () => {
    expect(
      retryDecision(config, { phase: 'intent', attempt: 1, error: { code: 'auth', message: '' } as never }),
    ).toEqual({
      retryable: false,
    })
  })

  test('validation_failed never retries', () => {
    expect(
      retryDecision(config, {
        phase: 'intent',
        attempt: 1,
        error: { code: 'validation_failed', message: '', reason: { code: 'empty_file' } } as never,
      }),
    ).toEqual({ retryable: false })
  })

  test('aborted never retries', () => {
    expect(
      retryDecision(config, { phase: 'upload', attempt: 1, error: { code: 'aborted', message: '' } as never }),
    ).toEqual({ retryable: false })
  })

  test('stops retrying once attempt >= maxAttempts', () => {
    expect(
      retryDecision(config, { phase: 'upload', attempt: 3, error: { code: 'network', message: '' } as never }),
    ).toEqual({ retryable: false })
  })

  test('exponential backoff escalates by attempt', () => {
    const a1 = retryDecision(config, { phase: 'upload', attempt: 1, error: { code: 'network', message: '' } as never })
    const a2 = retryDecision(config, { phase: 'upload', attempt: 2, error: { code: 'network', message: '' } as never })
    expect(a1.retryable).toBe(true)
    expect(a2.retryable).toBe(true)
    if (a1.retryable && a2.retryable) {
      expect(a2.delayMs).toBeGreaterThan(a1.delayMs ?? 0)
    }
  })
})

describe('isAbortError', () => {
  test('matches the aborted shape', () => {
    expect(isAbortError({ code: 'aborted' })).toBe(true)
    expect(isAbortError({ code: 'aborted', reason: 'pause' })).toBe(true)
  })

  test('rejects other shapes', () => {
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError({})).toBe(false)
    expect(isAbortError({ code: 'http' })).toBe(false)
  })
})

describe('isMultipartIntent', () => {
  test('accepts a complete multipart intent', () => {
    expect(isMultipartIntent({ strategy: 'multipart', fileId: 'f', uploadId: 'u', partSize: 1 })).toBe(true)
  })

  test('rejects when fields are missing', () => {
    expect(isMultipartIntent({ strategy: 'multipart' })).toBe(false)
    expect(isMultipartIntent({ strategy: 'post', fileId: 'f', uploadId: 'u' })).toBe(false)
  })
})

describe('calculateFileChecksum', () => {
  beforeEach(() => {
    __checksumNoticesEmitted.clear()
  })

  test('produces a hex digest', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'a.bin')
    const h = await calculateFileChecksum(file)
    expect(h).toMatch(/^[0-9a-f]+$/)
    expect(h && h.length).toBeGreaterThan(0)
  })

  test('different files produce different hashes', async () => {
    const a = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 9])], 'a.bin')
    const b = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 1])], 'b.bin')
    const ha = await calculateFileChecksum(a)
    const hb = await calculateFileChecksum(b)
    expect(ha).not.toBe(hb)
  })

  // SEC-007/018: cap is now a *skip* threshold, not a strategy switch.
  test('file at the threshold uses arrayBuffer() (sub-cap path)', async () => {
    const bytes = new Uint8Array(64)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i
    const file = new File([bytes], 'cap.bin')
    const abSpy = vi.spyOn(file, 'arrayBuffer')
    const streamSpy = vi.spyOn(file, 'stream')
    const h = await calculateFileChecksum(file, 64) // size 64, cap 64 -> NOT above
    expect(h).toMatch(/^[0-9a-f]+$/)
    expect(abSpy).toHaveBeenCalledTimes(1)
    expect(streamSpy).not.toHaveBeenCalled()
  })

  test('file below threshold uses arrayBuffer() and produces a digest', async () => {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 3) & 0xff
    const file = new File([bytes], 'small.bin')
    const abSpy = vi.spyOn(file, 'arrayBuffer')
    const streamSpy = vi.spyOn(file, 'stream')
    const h = await calculateFileChecksum(file, 64) // size 32 < cap 64
    expect(h).toMatch(/^[0-9a-f]+$/)
    expect(abSpy).toHaveBeenCalledTimes(1)
    expect(streamSpy).not.toHaveBeenCalled()
  })

  test('file above threshold returns null and performs NO I/O on the file', async () => {
    const bytes = new Uint8Array(128)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff
    const file = new File([bytes], 'big.bin')
    const abSpy = vi.spyOn(file, 'arrayBuffer')
    const streamSpy = vi.spyOn(file, 'stream')
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const h = await calculateFileChecksum(file, 16) // size 128 > cap 16
    expect(h).toBeNull()
    expect(abSpy).not.toHaveBeenCalled()
    expect(streamSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(String(infoSpy.mock.calls[0]?.[0] ?? '')).toMatch(/checksumMaxSize/)
    infoSpy.mockRestore()
  })

  test('repeated above-cap calls only emit the console.info notice once', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    for (let i = 0; i < 5; i++) {
      const file = new File([new Uint8Array(64)], `big-${i}.bin`)
      const h = await calculateFileChecksum(file, 8)
      expect(h).toBeNull()
    }
    expect(infoSpy).toHaveBeenCalledTimes(1)
    infoSpy.mockRestore()
  })

  test('maxSize of 0 or null falls back to default cap (no skip for tiny files)', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'tiny.bin')
    const streamSpy = vi.spyOn(file, 'stream')
    const h = await calculateFileChecksum(file, 0)
    expect(h).toMatch(/^[0-9a-f]+$/)
    expect(streamSpy).not.toHaveBeenCalled()
  })
})
