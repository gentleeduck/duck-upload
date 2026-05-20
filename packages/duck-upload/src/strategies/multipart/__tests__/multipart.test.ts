import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { UploadTransport } from '../../../core/contracts'
import { __resetMultipartWarningsForTests, multipartStrategy, validatePartUrl } from '../index'

describe('validatePartUrl', () => {
  beforeEach(() => {
    __resetMultipartWarningsForTests()
  })

  test('rejects file:// URL', () => {
    expect(() => validatePartUrl('file:///etc/passwd')).toThrow(/forbidden protocol/)
  })

  test('rejects javascript: URL', () => {
    expect(() => validatePartUrl('javascript:alert(1)')).toThrow(/forbidden protocol/)
  })

  test('rejects malformed URL', () => {
    expect(() => validatePartUrl('not a url')).toThrow(/malformed/)
  })

  test('rejects empty URL', () => {
    expect(() => validatePartUrl('')).toThrow(/invalid URL/)
  })

  test('rejects URL containing ".." segment', () => {
    expect(() => validatePartUrl('https://upload.example.com/a/../b')).toThrow(/\.\./)
  })

  test('rejects http://127.0.0.1/upload when allowPrivateHosts is false', () => {
    expect(() => validatePartUrl('http://127.0.0.1/upload')).toThrow(/private\/loopback/)
  })

  test('rejects RFC1918 hosts (10/8, 172.16/12, 192.168/16)', () => {
    expect(() => validatePartUrl('http://10.0.0.5/x')).toThrow(/private\/loopback/)
    expect(() => validatePartUrl('http://172.16.1.1/x')).toThrow(/private\/loopback/)
    expect(() => validatePartUrl('http://192.168.1.1/x')).toThrow(/private\/loopback/)
  })

  test('rejects IPv6 loopback ::1 and link-local fe80::', () => {
    expect(() => validatePartUrl('http://[::1]/x')).toThrow(/private\/loopback/)
    expect(() => validatePartUrl('http://[fe80::1]/x')).toThrow(/private\/loopback/)
    expect(() => validatePartUrl('http://[fc00::1]/x')).toThrow(/private\/loopback/)
  })

  test('accepts http://127.0.0.1/upload when allowPrivateHosts is true', () => {
    expect(() => validatePartUrl('http://127.0.0.1/upload', { allowPrivateHosts: true })).not.toThrow()
  })

  test('allowedHosts: accepts listed host, rejects others', () => {
    expect(() =>
      validatePartUrl('https://upload.example.com/parts/3', {
        allowedHosts: ['upload.example.com'],
      }),
    ).not.toThrow()

    expect(() =>
      validatePartUrl('https://evil.example.com/parts/3', {
        allowedHosts: ['upload.example.com'],
      }),
    ).toThrow(/allow-list/)
  })

  test('allowedHosts matches case-insensitively and is port-aware', () => {
    expect(() =>
      validatePartUrl('https://Upload.Example.COM:8443/p', {
        allowedHosts: ['upload.example.com:8443'],
      }),
    ).not.toThrow()

    expect(() =>
      validatePartUrl('https://upload.example.com:9000/p', {
        allowedHosts: ['upload.example.com:8443'],
      }),
    ).toThrow(/allow-list/)
  })

  test('warns once on omitted allowedHosts, suppresses on subsequent calls', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      validatePartUrl('https://upload.example.com/a')
      validatePartUrl('https://upload.example.com/b')
      validatePartUrl('https://upload.example.com/c')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[0]).toMatch(/allowedHosts/)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('multipartStrategy — happy path', () => {
  beforeEach(() => {
    __resetMultipartWarningsForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeCtx(opts: { signPartUrl: string; fileSize?: number }) {
    const size = opts.fileSize ?? 8
    const file = new File([new Uint8Array(size)], 'a.bin')
    const transport: Pick<UploadTransport, 'put' | 'postForm' | 'patch'> = {
      put: vi.fn(async (_args: Parameters<UploadTransport['put']>[0]) => ({ etag: 'etag-1' })),
      postForm: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
    }

    const cursors: Array<unknown> = []
    const ctx = {
      file,
      intent: {
        strategy: 'multipart' as const,
        fileId: 'f1',
        uploadId: 'u1',
        partSize: size, // one part
        partCount: 1,
      },
      signal: new AbortController().signal,
      transport: transport as UploadTransport,
      api: {
        createIntent: vi.fn(),
        complete: vi.fn(),
        multipart: {
          signPart: vi.fn(async () => ({ url: opts.signPartUrl, headers: undefined })),
          completeMultipart: vi.fn(async () => undefined),
        },
      } as unknown as Parameters<ReturnType<typeof multipartStrategy>['start']>[0]['api'],
      readCursor: () => undefined,
      persistCursor: (c: unknown) => {
        cursors.push(c)
      },
      reportProgress: () => {},
    }
    return { ctx, transport, cursors }
  }

  test('signed https://upload.example.com URL flows through to transport.put', async () => {
    const { ctx, transport } = makeCtx({ signPartUrl: 'https://upload.example.com/parts/3' })
    const strat = multipartStrategy({ allowedHosts: ['upload.example.com'] })
    await strat.start(ctx as unknown as Parameters<typeof strat.start>[0])
    expect(transport.put).toHaveBeenCalledTimes(1)
    const callArgs = (transport.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { url: string }
    expect(callArgs.url).toBe('https://upload.example.com/parts/3')
  })

  test('file:// signed URL is rejected before reaching transport.put', async () => {
    const { ctx, transport } = makeCtx({ signPartUrl: 'file:///etc/passwd' })
    const strat = multipartStrategy({ allowedHosts: ['upload.example.com'] })
    await expect(strat.start(ctx as unknown as Parameters<typeof strat.start>[0])).rejects.toThrow(/forbidden protocol/)
    expect(transport.put).not.toHaveBeenCalled()
  })

  test('private-host signed URL is rejected when allowPrivateHosts is false', async () => {
    const { ctx, transport } = makeCtx({ signPartUrl: 'http://127.0.0.1/upload' })
    const strat = multipartStrategy({})
    // suppress the one-time warn
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(strat.start(ctx as unknown as Parameters<typeof strat.start>[0])).rejects.toThrow(/private\/loopback/)
    expect(transport.put).not.toHaveBeenCalled()
  })

  test('private-host signed URL is accepted when allowPrivateHosts is true', async () => {
    const { ctx, transport } = makeCtx({ signPartUrl: 'http://127.0.0.1/upload' })
    const strat = multipartStrategy({ allowPrivateHosts: true, allowedHosts: ['127.0.0.1'] })
    await strat.start(ctx as unknown as Parameters<typeof strat.start>[0])
    expect(transport.put).toHaveBeenCalledTimes(1)
  })
})
