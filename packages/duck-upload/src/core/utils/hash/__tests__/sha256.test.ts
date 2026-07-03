import { describe, expect, it } from 'vitest'
import { hashBlob, sha256HexOfBlob } from '../index'

/** Reference digest via native Web Crypto. */
async function subtleHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('sha256HexOfBlob', () => {
  it('matches known vectors', async () => {
    // FIPS 180-2 vectors.
    expect(await sha256HexOfBlob(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256HexOfBlob(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await sha256HexOfBlob(new Blob(['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq']))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('is chunk-size invariant', async () => {
    const bytes = new Uint8Array(4096)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xff
    const blob = new Blob([bytes])
    const expected = await subtleHex(bytes)
    for (const chunkSize of [1, 3, 55, 63, 64, 65, 128, 1000, 4096, 8192]) {
      expect(await sha256HexOfBlob(blob, { chunkSize })).toBe(expected)
    }
  })

  it('hashes across the 55/56/64-byte padding boundaries', async () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i++) bytes[i] = (i * 17) & 0xff
      expect(await sha256HexOfBlob(new Blob([bytes]), { chunkSize: 7 })).toBe(await subtleHex(bytes))
    }
  })

  it('aborts between slices', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      sha256HexOfBlob(new Blob([new Uint8Array(1000)]), { chunkSize: 10, signal: controller.signal }),
    ).rejects.toThrow(/abort/i)
  })
})

describe('hashBlob', () => {
  it('inline and incremental paths agree', async () => {
    const bytes = new Uint8Array(2048)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff
    const blob = new Blob([bytes])
    const inline = await hashBlob(blob, { inlineMaxSize: 4096 }) // <= boundary -> subtle
    const incremental = await hashBlob(blob, { inlineMaxSize: 16, chunkSize: 100 }) // > boundary -> incremental
    expect(inline).toBe(incremental)
    expect(inline).toBe(await subtleHex(bytes))
  })
})
