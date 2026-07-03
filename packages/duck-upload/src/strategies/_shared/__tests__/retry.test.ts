import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_RETRIES, isAbort, isRetryable, withRetry } from '../retry'

describe('isAbort', () => {
  it('detects AbortError by name', () => {
    const err = new Error('cancelled')
    err.name = 'AbortError'
    expect(isAbort(err)).toBe(true)
  })

  it('detects abort by message', () => {
    expect(isAbort(new Error('request was aborted'))).toBe(true)
  })

  it('is false for plain errors and non-errors', () => {
    expect(isAbort(new Error('network down'))).toBe(false)
    expect(isAbort('abort')).toBe(false)
  })
})

describe('isRetryable', () => {
  it('matches transient network wording and codes', () => {
    expect(isRetryable(new Error('network error'))).toBe(true)
    expect(isRetryable(new Error('socket timeout'))).toBe(true)
    expect(isRetryable(new Error('Upload failed with status 503'))).toBe(true)
    expect(isRetryable(new Error('read ECONNRESET'))).toBe(true)
    expect(isRetryable(new Error('connect EHOSTUNREACH'))).toBe(true)
  })

  it('is false for non-transient errors', () => {
    expect(isRetryable(new Error('validation failed'))).toBe(false)
    expect(isRetryable(new Error('Upload failed with status 403'))).toBe(false)
  })
})

describe('withRetry', () => {
  it('returns first-attempt result without retrying', async () => {
    const fn = vi.fn(async () => 'ok')
    await expect(withRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries transient failures then succeeds', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('network glitch')
      return calls
    })
    await expect(withRetry(fn, { maxRetries: 5 })).resolves.toBe(3)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('passes the zero-based attempt index to fn', async () => {
    const seen: number[] = []
    let calls = 0
    await withRetry(
      async (attempt) => {
        seen.push(attempt)
        calls++
        if (calls < 3) throw new Error('timeout')
        return null
      },
      { maxRetries: 5 },
    )
    expect(seen).toEqual([0, 1, 2])
  })

  it('gives up after maxRetries and rethrows', async () => {
    const fn = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow('network down')
    // first attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('validation failed')
    })
    await expect(withRetry(fn)).rejects.toThrow('validation failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry aborts', async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    const fn = vi.fn(async () => {
      throw err
    })
    await expect(withRetry(fn)).rejects.toThrow('aborted')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('stops immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toThrow('network down')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('honors a custom retryable predicate', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 2) throw new Error('please retry me')
      return 'done'
    })
    await expect(withRetry(fn, { retryable: (e) => /retry me/.test(String(e)) })).resolves.toBe('done')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('exposes a sane default retry count', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(3)
  })
})
