import { beforeEach, describe, expect, test, vi } from 'vitest'
import { __resetPutWarningsForTests, type PutIntent, PutStrategy } from '../index'

function makeCtx(url: string, overrides: Partial<PutIntent> = {}) {
  const file = new File(['hello world'], 'a.txt', { type: 'text/plain' })
  return {
    intent: { strategy: 'put', fileId: 'f', url, ...overrides } satisfies PutIntent,
    file,
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    transport: {
      put: vi.fn(async () => ({ etag: 'abc', headers: {} })),
    },
  }
}

describe('PutStrategy SSRF guard', () => {
  beforeEach(() => {
    __resetPutWarningsForTests()
  })

  test('rejects file://', async () => {
    const s = PutStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('file:///etc/passwd') as any)).rejects.toThrow(/forbidden protocol/)
  })

  test('rejects javascript:', async () => {
    const s = PutStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('javascript:alert(1)') as any)).rejects.toThrow(/forbidden protocol/)
  })

  test('rejects loopback', async () => {
    const s = PutStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('https://127.0.0.1/up') as any)).rejects.toThrow(/private/)
  })

  test('rejects AWS metadata IPv4', async () => {
    const s = PutStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('https://169.254.169.254/up') as any)).rejects.toThrow(/private/)
  })

  test('rejects host outside allowedHosts', async () => {
    const s = PutStrategy({ allowedHosts: ['up.example.com'] })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('https://evil.example.com/up') as any)).rejects.toThrow(/allow-list/)
  })

  test('accepts allowlisted host and PUTs the file body', async () => {
    const s = PutStrategy({ allowedHosts: ['up.example.com'] })
    const ctx = makeCtx('https://up.example.com/up', { headers: { 'Content-Type': 'text/plain' } })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).resolves.toBeUndefined()
    expect(ctx.transport.put).toHaveBeenCalledTimes(1)
    const arg = (ctx.transport.put.mock.calls[0] as unknown as [{ url: string; body: unknown; headers: unknown }])[0]
    expect(arg.url).toBe('https://up.example.com/up')
    expect(arg.body).toBe(ctx.file)
    expect(arg.headers).toEqual({ 'Content-Type': 'text/plain' })
  })

  test('allowPrivateHosts lets loopback through (opt-in)', async () => {
    const s = PutStrategy({ allowPrivateHosts: true })
    const ctx = makeCtx('https://127.0.0.1/up')
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).resolves.toBeUndefined()
  })

  test('warns once when allowedHosts not set', async () => {
    const s = PutStrategy()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
      await s.start(makeCtx('https://up.example.com/up') as any).catch(() => {})
      // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
      await s.start(makeCtx('https://up.example.com/up') as any).catch(() => {})
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  test('caller label is "put.intent"', async () => {
    const s = PutStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('file:///etc/passwd') as any)).rejects.toThrow(/put\.intent/)
  })

  test('throws when intent has no url', async () => {
    const s = PutStrategy()
    const ctx = makeCtx('https://up.example.com/up')
    // biome-ignore lint/suspicious/noExplicitAny: intentionally clearing the url
    ;(ctx.intent as any).url = ''
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).rejects.toThrow(/missing url/)
  })
})

describe('PutStrategy retry', () => {
  beforeEach(() => {
    __resetPutWarningsForTests()
  })

  test('retries a transient failure then succeeds', async () => {
    const s = PutStrategy({ allowedHosts: ['up.example.com'], maxRetries: 2 })
    const ctx = makeCtx('https://up.example.com/up')
    let calls = 0
    ctx.transport.put = vi.fn(async () => {
      calls++
      if (calls < 2) throw new Error('network error')
      return { etag: 'ok', headers: {} }
    })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).resolves.toBeUndefined()
    expect(calls).toBe(2)
  })

  test('does not retry a non-transient failure', async () => {
    const s = PutStrategy({ allowedHosts: ['up.example.com'] })
    const ctx = makeCtx('https://up.example.com/up')
    let calls = 0
    ctx.transport.put = vi.fn(async () => {
      calls++
      throw new Error('Upload failed with status 403')
    })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).rejects.toThrow(/403/)
    expect(calls).toBe(1)
  })
})
