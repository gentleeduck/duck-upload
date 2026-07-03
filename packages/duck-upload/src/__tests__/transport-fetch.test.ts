import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFetchTransport } from '../core/contracts/transport'
import { UploadAbortError } from '../core/contracts/transport/transport.libs'

const URL_OK = 'https://up.example.com/o'

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createFetchTransport.put', () => {
  test('PUTs the body and returns the ETag', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200, headers: { ETag: '"deadbeef"' } }))
    const t = createFetchTransport()
    const onProgress = vi.fn()
    const out = await t.put({
      url: URL_OK,
      body: new Blob([new Uint8Array(10)]),
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: new AbortController().signal,
      onProgress,
    })

    expect(out.etag).toBe('deadbeef')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(URL_OK)
    expect(init.method).toBe('PUT')
    // Terminal progress tick.
    expect(onProgress).toHaveBeenCalledWith(10, 10)
  })

  test('rejects non-2xx with the status', async () => {
    stubFetch(() => new Response('nope', { status: 500 }))
    const t = createFetchTransport()
    await expect(t.put({ url: URL_OK, body: new Blob(['x']), signal: new AbortController().signal })).rejects.toThrow(
      /status 500/,
    )
  })

  test('rejects a relative URL', async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    const t = createFetchTransport()
    await expect(
      t.put({ url: '/relative', body: new Blob(['x']), signal: new AbortController().signal }),
    ).rejects.toThrow(/absolute URL/)
  })

  test('maps an aborted signal to UploadAbortError', async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    const controller = new AbortController()
    controller.abort('cancel')
    const t = createFetchTransport()
    await expect(t.put({ url: URL_OK, body: new Blob(['x']), signal: controller.signal })).rejects.toBeInstanceOf(
      UploadAbortError,
    )
  })
})

describe('createFetchTransport.postForm', () => {
  test('sends multipart form data', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }))
    const t = createFetchTransport()
    await t.postForm({
      url: URL_OK,
      fields: { key: 'v', policy: 'p' },
      file: new File(['abc'], 'a.txt'),
      signal: new AbortController().signal,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })
})

describe('createFetchTransport.get', () => {
  test('streams the body and reports incremental progress', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    stubFetch(
      () =>
        new Response(payload, {
          status: 200,
          headers: { 'Content-Length': String(payload.length), 'Content-Type': 'application/octet-stream' },
        }),
    )
    const t = createFetchTransport()
    const onProgress = vi.fn()
    const out = await t.get?.({ url: URL_OK, signal: new AbortController().signal, onProgress })
    expect(out?.status).toBe(200)
    const bytes = new Uint8Array(await out!.blob.arrayBuffer())
    expect(Array.from(bytes)).toEqual(Array.from(payload))
    // Final progress equals total.
    const last = onProgress.mock.calls.at(-1)
    expect(last?.[0]).toBe(payload.length)
    expect(last?.[1]).toBe(payload.length)
  })

  test('rejects a failed download', async () => {
    stubFetch(() => new Response('nope', { status: 404 }))
    const t = createFetchTransport()
    await expect(t.get?.({ url: URL_OK, signal: new AbortController().signal })).rejects.toThrow(/status 404/)
  })
})
