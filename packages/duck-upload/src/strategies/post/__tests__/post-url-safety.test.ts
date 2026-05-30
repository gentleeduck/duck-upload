import { beforeEach, describe, expect, test, vi } from 'vitest'
import { __resetPostWarningsForTests, type PostIntent, PostStrategy } from '../index'

function makeCtx(url: string) {
  const file = new File(['hello'], 'a.txt', { type: 'text/plain' })
  return {
    intent: { strategy: 'post', fileId: 'f', url, fields: {} } satisfies PostIntent,
    file,
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    transport: {
      postForm: vi.fn(async () => ({ headers: {} })),
    },
  }
}

describe('PostStrategy SSRF guard', () => {
  beforeEach(() => {
    __resetPostWarningsForTests()
  })

  test('rejects file://', async () => {
    const s = PostStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('file:///etc/passwd') as any)).rejects.toThrow(/forbidden protocol/)
  })

  test('rejects javascript:', async () => {
    const s = PostStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('javascript:alert(1)') as any)).rejects.toThrow(/forbidden protocol/)
  })

  test('rejects loopback', async () => {
    const s = PostStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('https://127.0.0.1/up') as any)).rejects.toThrow(/private/)
  })

  test('rejects AWS metadata IPv4', async () => {
    const s = PostStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('https://169.254.169.254/up') as any)).rejects.toThrow(/private/)
  })

  test('rejects host outside allowedHosts', async () => {
    const s = PostStrategy({ allowedHosts: ['up.example.com'] })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('https://evil.example.com/up') as any)).rejects.toThrow(/allow-list/)
  })

  test('accepts allowlisted host', async () => {
    const s = PostStrategy({ allowedHosts: ['up.example.com'] })
    const ctx = makeCtx('https://up.example.com/up')
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).resolves.toBeUndefined()
    expect(ctx.transport.postForm).toHaveBeenCalled()
  })

  test('allowPrivateHosts lets loopback through (opt-in)', async () => {
    const s = PostStrategy({ allowPrivateHosts: true })
    const ctx = makeCtx('https://127.0.0.1/up')
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).resolves.toBeUndefined()
  })

  test('warns once when allowedHosts not set', async () => {
    const s = PostStrategy()
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

  test('caller label is "post.intent"', async () => {
    const s = PostStrategy()
    // biome-ignore lint/suspicious/noExplicitAny: test ctx shape is a subset of the full strategy ctx
    await expect(s.start(makeCtx('file:///etc/passwd') as any)).rejects.toThrow(/post\.intent/)
  })
})
