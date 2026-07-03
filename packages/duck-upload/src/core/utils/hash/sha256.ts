// biome-ignore-all lint/style/noNonNullAssertion: fixed-bounds reads over Uint8/Uint32Array in the SHA-256 hot loop are always defined; asserting avoids per-read branches.

/**
 * Pure-JS incremental SHA-256 over a `Blob`/`File`.
 *
 * Web Crypto (`crypto.subtle.digest`) has no streaming/incremental API, so it
 * must buffer the whole file in memory. This implementation reads the blob in
 * bounded slices and folds each into the digest state, so memory stays flat
 * regardless of file size.
 *
 * The whole algorithm lives inside a single self-contained function with no
 * external references (constants and helpers are declared locally). That lets
 * {@link ./index} stringify it with `Function.prototype.toString` and run it
 * verbatim inside a Web Worker, keeping large-file hashing off the main thread.
 *
 * @author wildduck2 <https://github.com/wildduck2>
 */

/** Default slice size fed to the hasher: 8 MiB. */
export const DEFAULT_HASH_CHUNK_SIZE = 8 * 1024 * 1024

/**
 * Compute the lowercase hex SHA-256 digest of `blob`, reading it in bounded
 * slices so peak memory is `~chunkSize` rather than the whole file.
 *
 * @param blob - Source bytes (a `File` is a `Blob`).
 * @param opts.chunkSize - Slice size in bytes. Defaults to {@link DEFAULT_HASH_CHUNK_SIZE}.
 * @param opts.signal - Optional abort signal, checked between slices.
 * @returns 64-char lowercase hex digest.
 */
export async function sha256HexOfBlob(
  blob: Blob,
  opts?: { chunkSize?: number; signal?: AbortSignal },
): Promise<string> {
  const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : 8 * 1024 * 1024
  const signal = opts?.signal

  // Round constants (first 32 bits of the fractional parts of the cube roots
  // of the first 64 primes).
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ])

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const w = new Uint32Array(64)
  const block = new Uint8Array(64)
  let blockLen = 0
  let totalLen = 0

  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

  const compress = (): void => {
    for (let i = 0; i < 16; i++) {
      const j = i * 4
      w[i] = ((block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const x15 = w[i - 15]!
      const x2 = w[i - 2]!
      const s0 = rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3)
      const s1 = rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let i = 0; i < 64; i++) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + bigS1 + ch + K[i]! + w[i]!) >>> 0
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (bigS0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const update = (bytes: Uint8Array): void => {
    totalLen += bytes.length
    let off = 0

    // Top up a partially filled block from a previous slice.
    if (blockLen > 0) {
      const take = Math.min(64 - blockLen, bytes.length)
      block.set(bytes.subarray(0, take), blockLen)
      blockLen += take
      off = take
      if (blockLen === 64) {
        compress()
        blockLen = 0
      }
    }

    // Consume whole 64-byte blocks directly from the slice.
    while (bytes.length - off >= 64) {
      block.set(bytes.subarray(off, off + 64), 0)
      compress()
      off += 64
    }

    // Stash the trailing remainder for the next slice / finalization.
    if (off < bytes.length) {
      const rest = bytes.subarray(off)
      block.set(rest, 0)
      blockLen = rest.length
    }
  }

  const size = blob.size
  for (let pos = 0; pos < size; pos += chunkSize) {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const end = Math.min(size, pos + chunkSize)
    const buf = await blob.slice(pos, end).arrayBuffer()
    update(new Uint8Array(buf))
  }

  // Finalize: append 0x80, pad with zeros, then the 64-bit big-endian bit length.
  const lenBits = totalLen * 8
  const hi = Math.floor(lenBits / 0x100000000) >>> 0
  const lo = lenBits >>> 0

  block[blockLen++] = 0x80
  if (blockLen > 56) {
    while (blockLen < 64) block[blockLen++] = 0
    compress()
    blockLen = 0
  }
  while (blockLen < 56) block[blockLen++] = 0
  block[56] = (hi >>> 24) & 0xff
  block[57] = (hi >>> 16) & 0xff
  block[58] = (hi >>> 8) & 0xff
  block[59] = hi & 0xff
  block[60] = (lo >>> 24) & 0xff
  block[61] = (lo >>> 16) & 0xff
  block[62] = (lo >>> 8) & 0xff
  block[63] = lo & 0xff
  compress()

  const toHex = (x: number): string => (x >>> 0).toString(16).padStart(8, '0')
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7)
}
