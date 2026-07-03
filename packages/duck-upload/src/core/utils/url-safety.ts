/**
 * SSRF guards for backend-supplied upload URLs.
 *
 * Every URL that arrives from a non-trusted backend (presigned POST,
 * presigned PUT, multipart part URLs) must pass through
 * `validateUploadUrl` before it reaches the transport. The guard
 * blocks:
 *
 * - Empty / non-string / malformed URLs
 * - `..` path-traversal segments (URL parser would normalize them away)
 * - Non-http(s) protocols (`file:`, `javascript:`, `data:`)
 * - IP literals pointing at loopback / RFC1918 / link-local /
 *   cloud-metadata / CGNAT / multicast / broadcast addresses
 * - IPv6 embedded IPv4 (mapped, compat, 6to4, NAT64) carrying any of the above
 *
 * DNS rebinding is out of scope for a client-side check.
 */

function hexTailToDottedQuad(tail: string): string | null {
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
  if (!m || m[1] === undefined || m[2] === undefined) return null
  const hi = parseInt(m[1], 16)
  const lo = parseInt(m[2], 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null
  if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return null
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}

/**
 * Returns true when `host` is a literal IP address in one of the
 * private / loopback / cloud-metadata ranges. Hostnames that aren't IP
 * literals return false.
 */
export function isPrivateHost(host: string): boolean {
  let h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (h.endsWith('.')) h = h.slice(0, -1)

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    const c = Number(v4[3])
    const d = Number(v4[4])
    if (a > 255 || b > 255 || c > 255 || d > 255) return false
    if (a === 127) return true // 127.0.0.0/8 loopback
    if (a === 10) return true // 10.0.0.0/8 RFC1918
    if (a === 192 && b === 168) return true // 192.168.0.0/16 RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 RFC1918
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local + AWS metadata
    if (a === 0) return true // 0.0.0.0/8 this-network
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a >= 224 && a <= 239) return true // 224.0.0.0/4 multicast
    if (a >= 240) return true // 240.0.0.0/4 reserved + broadcast
    return false
  }

  if (h.includes(':')) {
    const lower = h.toLowerCase()
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
    if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true // fc00::/7
    if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true // fe80::/10
    if (/^ff[0-9a-f]{0,2}:/.test(lower)) return true // ff00::/8 multicast

    let mappedTail: string | null = null
    if (lower.startsWith('::ffff:')) mappedTail = lower.slice(7)
    else if (lower.startsWith('0:0:0:0:0:ffff:')) mappedTail = lower.slice(15)
    if (mappedTail !== null) {
      if (mappedTail.includes('.')) return isPrivateHost(mappedTail)
      const dotted = hexTailToDottedQuad(mappedTail)
      if (dotted) return isPrivateHost(dotted)
      return false
    }

    if (lower.startsWith('::') && lower.includes('.')) {
      const tail = lower.slice(2)
      if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(tail)) return isPrivateHost(tail)
    }

    if (lower.startsWith('2002:')) {
      const m = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(lower)
      if (m) {
        const dotted = hexTailToDottedQuad(`${m[1]}:${m[2]}`)
        if (dotted) return isPrivateHost(dotted)
      }
    }

    if (lower.startsWith('64:ff9b:') || lower.startsWith('0064:ff9b:')) {
      const tail = lower.startsWith('0064:') ? lower.slice(10) : lower.slice(8)
      if (tail.includes('.')) {
        const v4match = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(tail)
        if (v4match?.[1] !== undefined) return isPrivateHost(v4match[1])
      }
      const groups = tail.split(':').filter((g) => g.length > 0)
      if (groups.length >= 2) {
        const dotted = hexTailToDottedQuad(`${groups[groups.length - 2]}:${groups[groups.length - 1]}`)
        if (dotted) return isPrivateHost(dotted)
      }
    }

    return false
  }

  return false
}

/**
 * Throw-on-reject URL guard. Use from any strategy whose backend may
 * return adversarial / compromised URLs. `caller` is a short label
 * ('multipart.signPart', 'post.intent', etc.) included in error messages
 * so logs name the source.
 */
export function validateUploadUrl(
  rawUrl: string,
  caller: string,
  opts: { allowedHosts?: string[]; allowPrivateHosts?: boolean } = {},
): void {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new Error(`${caller} returned an invalid URL (empty or non-string)`)
  }

  // Cap raw URL length. Real presigned URLs are well under 4 KB; anything
  // larger is either a server bug or an attacker probing the parser.
  if (rawUrl.length > 8192) {
    throw new Error(`${caller} URL exceeds 8192-byte length cap`)
  }

  if (rawUrl.includes('..')) {
    throw new Error(`${caller} URL contains forbidden ".." segment`)
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`${caller} returned a malformed URL`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${caller} URL has forbidden protocol "${parsed.protocol}"`)
  }

  if (opts.allowedHosts && opts.allowedHosts.length > 0) {
    const host = parsed.host.toLowerCase()
    const list = opts.allowedHosts.map((h) => h.toLowerCase())
    if (!list.includes(host)) {
      throw new Error(`${caller} URL host is not in the configured allow-list`)
    }
  }

  if (!opts.allowPrivateHosts) {
    if (isPrivateHost(parsed.hostname)) {
      throw new Error(`${caller} URL points to a private/loopback host`)
    }
  }
}
