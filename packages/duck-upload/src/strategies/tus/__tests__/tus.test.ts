import { beforeEach, describe, expect, test, vi } from 'vitest'
import { __resetTusWarningsForTests, type TusIntent, TusStrategy } from '../index'

type CursorState = { offset: number } | undefined

/**
 * Build a fake strategy ctx backed by an in-memory tus server that tracks its
 * own offset and grows it by the size of each accepted PATCH.
 */
function makeCtx(opts: {
  fileBytes: number
  url?: string
  intentChunkSize?: number
  cursor?: CursorState
  headOffset?: number | null // null = HEAD omitted from transport
  serverStartOffset?: number
}) {
  const { fileBytes, url = 'https://tus.example.com/files/abc', cursor, headOffset = 0, serverStartOffset = 0 } = opts

  const file = new File([new Uint8Array(fileBytes)], 'a.bin')
  let persisted: CursorState = cursor
  let serverOffset = serverStartOffset

  const patch = vi.fn(async (args: { headers?: Record<string, string>; body: Blob }) => {
    const sent = Number(args.headers?.['Upload-Offset'] ?? args.headers?.['upload-offset'])
    // Simulate the server accepting the chunk at the declared offset.
    serverOffset = sent + args.body.size
    return { headers: { 'upload-offset': String(serverOffset) } }
  })

  const transport: Record<string, unknown> = { patch }
  if (headOffset !== null) {
    transport['head'] = vi.fn(async () => ({
      status: 200,
      headers: { 'upload-offset': String(headOffset) },
    }))
  }

  const intent: TusIntent = { strategy: 'tus', fileId: 'f', url }
  if (opts.intentChunkSize) intent.chunkSize = opts.intentChunkSize

  const ctx = {
    intent,
    file,
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    readCursor: () => persisted,
    persistCursor: (c: CursorState) => {
      persisted = c
    },
    transport,
    get persistedOffset() {
      return persisted?.offset
    },
  }
  return {
    ctx,
    patch,
    get server() {
      return serverOffset
    },
  }
}

describe('TusStrategy', () => {
  beforeEach(() => {
    __resetTusWarningsForTests()
  })

  test('uploads a file in chunks and completes', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'], chunkSize: 10 })
    const { ctx, patch } = makeCtx({ fileBytes: 25, intentChunkSize: 10 })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).resolves.toBeUndefined()
    // 25 bytes / 10 per chunk -> 3 PATCHes (10, 10, 5)
    expect(patch).toHaveBeenCalledTimes(3)
    const sizes = patch.mock.calls.map((c) => (c[0] as { body: Blob }).body.size)
    expect(sizes).toEqual([10, 10, 5])
    // biome-ignore lint/suspicious/noExplicitAny: reading test helper getter
    expect((ctx as any).persistedOffset).toBe(25)
  })

  test('sends the tus protocol headers', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'] })
    const { ctx, patch } = makeCtx({ fileBytes: 5, intentChunkSize: 10 })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await s.start(ctx as any)
    const headers = (patch.mock.calls[0]?.[0] as { headers: Record<string, string> }).headers
    expect(headers['Tus-Resumable']).toBe('1.0.0')
    expect(headers['Upload-Offset']).toBe('0')
    expect(headers['Content-Type']).toBe('application/offset+octet-stream')
  })

  test('resumes from the server HEAD offset, not the start', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'], chunkSize: 10 })
    // Server already has 20 of 25 bytes.
    const { ctx, patch } = makeCtx({
      fileBytes: 25,
      intentChunkSize: 10,
      headOffset: 20,
      serverStartOffset: 20,
    })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await s.start(ctx as any)
    // Only the final 5 bytes remain -> one PATCH.
    expect(patch).toHaveBeenCalledTimes(1)
    expect((patch.mock.calls[0]?.[0] as { body: Blob }).body.size).toBe(5)
    const startHeader = (patch.mock.calls[0]?.[0] as { headers: Record<string, string> }).headers['Upload-Offset']
    expect(startHeader).toBe('20')
  })

  test('falls back to the persisted cursor when no HEAD transport', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'], chunkSize: 10 })
    const { ctx, patch } = makeCtx({
      fileBytes: 25,
      intentChunkSize: 10,
      headOffset: null, // no head() on transport
      cursor: { offset: 20 },
      serverStartOffset: 20,
    })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await s.start(ctx as any)
    expect(patch).toHaveBeenCalledTimes(1)
    expect((patch.mock.calls[0]?.[0] as { body: Blob }).body.size).toBe(5)
  })

  test('is a no-op when already fully uploaded', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'] })
    const { ctx, patch } = makeCtx({ fileBytes: 25, headOffset: 25, serverStartOffset: 25 })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await s.start(ctx as any)
    expect(patch).not.toHaveBeenCalled()
  })

  test('rejects a non-allowlisted host', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'] })
    const { ctx } = makeCtx({ fileBytes: 5, url: 'https://evil.example.com/f' })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).rejects.toThrow(/allow-list/)
  })

  test('rejects file:// URL', async () => {
    const s = TusStrategy()
    const { ctx } = makeCtx({ fileBytes: 5, url: 'file:///etc/passwd' })
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).rejects.toThrow(/forbidden protocol/)
  })

  test('bails when the server never advances the offset', async () => {
    const s = TusStrategy({ allowedHosts: ['tus.example.com'], chunkSize: 10 })
    const { ctx } = makeCtx({ fileBytes: 25, intentChunkSize: 10 })
    // Server that always reports offset 0 -> no forward progress.
    ;(ctx.transport as { patch: unknown }).patch = vi.fn(async () => ({
      headers: { 'upload-offset': '0' },
    }))
    // biome-ignore lint/suspicious/noExplicitAny: test ctx is a subset of the full strategy ctx
    await expect(s.start(ctx as any)).rejects.toThrow(/did not advance/)
  })
})
