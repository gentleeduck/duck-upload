/**
 * Generate a unique upload ID.
 *
 * Format: `upload_<unix-ms>_<uuid-v4>`. The UUID is produced by
 * {@link Crypto.randomUUID} on platforms that expose it (Node >= 14.17,
 * all modern browsers in secure contexts). On legacy runtimes we fall
 * back to {@link Crypto.getRandomValues} + manual v4 formatting.
 *
 * Throws if no CSPRNG is reachable - `Math.random()` is deliberately
 * NOT used (SEC-006: predictable IDs collide and leak ordering).
 */
export function generateId(): string {
  return `upload_${Date.now()}_${randomUUIDv4()}`
}

function randomUUIDv4(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    // RFC 4122 section 4.4 - set version (4) and variant (10xx). bytes is fixed-length 16, every index is in-bounds.
    const b6 = bytes[6] ?? 0
    const b8 = bytes[8] ?? 0
    bytes[6] = (b6 & 0x0f) | 0x40
    bytes[8] = (b8 & 0x3f) | 0x80
    const hex: string[] = []
    for (let i = 0; i < bytes.length; i++) hex.push((bytes[i] ?? 0).toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }
  throw new Error('[duck-upload] No CSPRNG available: crypto.randomUUID and crypto.getRandomValues both missing')
}
