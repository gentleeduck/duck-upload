import { describe, expect, test } from 'vitest'
import { isPrivateHost, validateUploadUrl } from '../url-safety'

describe('isPrivateHost - IPv4', () => {
  test('127.0.0.1 (loopback)', () => expect(isPrivateHost('127.0.0.1')).toBe(true))
  test('10.0.0.1 (RFC1918)', () => expect(isPrivateHost('10.0.0.1')).toBe(true))
  test('172.16.0.1 (RFC1918)', () => expect(isPrivateHost('172.16.0.1')).toBe(true))
  test('172.31.255.255 (RFC1918 upper edge)', () => expect(isPrivateHost('172.31.255.255')).toBe(true))
  test('172.32.0.1 (just outside RFC1918)', () => expect(isPrivateHost('172.32.0.1')).toBe(false))
  test('192.168.1.1 (RFC1918)', () => expect(isPrivateHost('192.168.1.1')).toBe(true))
  test('169.254.169.254 (AWS metadata)', () => expect(isPrivateHost('169.254.169.254')).toBe(true))
  test('0.0.0.0 (this-network)', () => expect(isPrivateHost('0.0.0.0')).toBe(true))
  test('100.64.0.1 (CGNAT)', () => expect(isPrivateHost('100.64.0.1')).toBe(true))
  test('224.0.0.1 (multicast)', () => expect(isPrivateHost('224.0.0.1')).toBe(true))
  test('255.255.255.255 (broadcast)', () => expect(isPrivateHost('255.255.255.255')).toBe(true))
  test('8.8.8.8 (public)', () => expect(isPrivateHost('8.8.8.8')).toBe(false))
  test('octet > 255 (malformed)', () => expect(isPrivateHost('256.0.0.0')).toBe(false))
})

describe('isPrivateHost - IPv6', () => {
  test('::1 (loopback)', () => expect(isPrivateHost('::1')).toBe(true))
  test('[::1] bracketed', () => expect(isPrivateHost('[::1]')).toBe(true))
  test(':: (unspecified)', () => expect(isPrivateHost('::')).toBe(true))
  test('fc00::1 (ULA)', () => expect(isPrivateHost('fc00::1')).toBe(true))
  test('fe80::1 (link-local)', () => expect(isPrivateHost('fe80::1')).toBe(true))
  test('ff00::1 (multicast)', () => expect(isPrivateHost('ff00::1')).toBe(true))
  test('2001:db8::1 (documentation)', () => expect(isPrivateHost('2001:db8::1')).toBe(false))
})

describe('isPrivateHost - IPv6 embedded IPv4', () => {
  test('::ffff:127.0.0.1 (IPv4-mapped, dotted-quad tail)', () => {
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true)
  })
  test('::ffff:7f00:1 (IPv4-mapped, hex tail)', () => {
    expect(isPrivateHost('::ffff:7f00:1')).toBe(true)
  })
  test('::127.0.0.1 (IPv4-compat)', () => expect(isPrivateHost('::127.0.0.1')).toBe(true))
  test('2002:7f00:1:: (6to4 carrying loopback)', () => expect(isPrivateHost('2002:7f00:1::')).toBe(true))
  test('64:ff9b::127.0.0.1 (NAT64 carrying loopback)', () => {
    expect(isPrivateHost('64:ff9b::127.0.0.1')).toBe(true)
  })
})

describe('isPrivateHost - hostnames are NOT IP literals', () => {
  test('example.com (FQDN)', () => expect(isPrivateHost('example.com')).toBe(false))
  test('localhost (resolves to loopback at runtime; not literal)', () => {
    expect(isPrivateHost('localhost')).toBe(false)
  })
})

describe('validateUploadUrl - rejected inputs', () => {
  test('empty', () => expect(() => validateUploadUrl('', 'test')).toThrow(/empty or non-string/))
  test('non-string', () => expect(() => validateUploadUrl(null as unknown as string, 'test')).toThrow())
  test('path traversal', () => expect(() => validateUploadUrl('https://x.com/../etc', 'test')).toThrow(/forbidden/))
  test('malformed', () => expect(() => validateUploadUrl('not a url', 'test')).toThrow(/malformed/))
  test('file://', () => expect(() => validateUploadUrl('file:///etc/passwd', 'test')).toThrow(/forbidden protocol/))
  test('javascript:', () =>
    expect(() => validateUploadUrl('javascript:alert(1)', 'test')).toThrow(/forbidden protocol/))
  test('data:', () => expect(() => validateUploadUrl('data:text/html,evil', 'test')).toThrow(/forbidden protocol/))
  test('private host', () => expect(() => validateUploadUrl('https://127.0.0.1/x', 'test')).toThrow(/private/))
  test('AWS metadata', () =>
    expect(() => validateUploadUrl('https://169.254.169.254/latest/meta-data/', 'test')).toThrow(/private/))
})

describe('validateUploadUrl - allowedHosts', () => {
  test('host in allowlist passes', () => {
    expect(() =>
      validateUploadUrl('https://up.example.com/x', 'test', { allowedHosts: ['up.example.com'] }),
    ).not.toThrow()
  })
  test('host outside allowlist rejected', () => {
    expect(() => validateUploadUrl('https://evil.example.com/x', 'test', { allowedHosts: ['up.example.com'] })).toThrow(
      /allow-list/,
    )
  })
  test('case-insensitive match', () => {
    expect(() =>
      validateUploadUrl('https://UP.Example.COM/x', 'test', { allowedHosts: ['up.example.com'] }),
    ).not.toThrow()
  })
  test('host with port matches list with port', () => {
    expect(() =>
      validateUploadUrl('https://up.example.com:8443/x', 'test', { allowedHosts: ['up.example.com:8443'] }),
    ).not.toThrow()
  })
})

describe('validateUploadUrl - length cap', () => {
  test('rejects URL > 8192 bytes', () => {
    const huge = `https://x.com/${'a'.repeat(9000)}`
    expect(() => validateUploadUrl(huge, 'test')).toThrow(/exceeds 8192-byte/)
  })
  test('accepts URL at the 8192 boundary', () => {
    const base = 'https://x.example.com/'
    const padded = base + 'a'.repeat(8192 - base.length)
    expect(padded.length).toBe(8192)
    expect(() => validateUploadUrl(padded, 'test')).not.toThrow()
  })
})

describe('validateUploadUrl - allowPrivateHosts opt-in', () => {
  test('127.0.0.1 passes when allowPrivateHosts true', () => {
    expect(() => validateUploadUrl('https://127.0.0.1/x', 'test', { allowPrivateHosts: true })).not.toThrow()
  })
})

describe('validateUploadUrl - caller label in error messages', () => {
  test('throws include the caller label', () => {
    expect(() => validateUploadUrl('file:///x', 'multipart.signPart')).toThrow(/multipart\.signPart/)
    expect(() => validateUploadUrl('https://127.0.0.1/x', 'post.intent')).toThrow(/post\.intent/)
  })
})
