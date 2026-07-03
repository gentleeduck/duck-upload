export type FilenameRejectReason = 'reserved' | 'too-long' | 'empty' | 'path-sep'

export type SanitizeFilenameResult =
  | { safe: true; normalised: string }
  | { safe: false; normalised: string; reason: FilenameRejectReason }

const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

function stripControlChars(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0x20 && c !== 0x7f) out += s[i]
  }
  return out
}

/**
 * Normalise and validate an untrusted filename. Returns
 * `{ safe: true, normalised }` when the name is safe to forward to a backend,
 * or `{ safe: false, normalised, reason }` with the partial cleanup for
 * diagnostics. Pure and synchronous.
 */
export function sanitizeFilename(name: string): SanitizeFilenameResult {
  // NFKC normalise.
  let n = name.normalize('NFKC')

  // Strip control chars and DEL.
  n = stripControlChars(n)

  // Strip leading dashes.
  while (n.startsWith('-')) n = n.slice(1)

  // Strip trailing dots and spaces (Windows behaviour).
  while (n.length > 0 && (n.endsWith('.') || n.endsWith(' '))) n = n.slice(0, -1)

  // Reject if nothing survived.
  if (n.length === 0) {
    return { safe: false, normalised: n, reason: 'empty' }
  }

  // Path separators must never reach here.
  if (n.includes('/') || n.includes('\\')) {
    return { safe: false, normalised: n, reason: 'path-sep' }
  }

  // Length cap.
  if (n.length > 255) {
    return { safe: false, normalised: n, reason: 'too-long' }
  }

  // Reserved Windows device names — match the base (before the first dot),
  // case-insensitive. `CON.txt`, `nul`, `COM1.tar.gz` all reject.
  const dot = n.indexOf('.')
  const base = (dot === -1 ? n : n.slice(0, dot)).toUpperCase()
  if (RESERVED_WINDOWS_NAMES.has(base)) {
    return { safe: false, normalised: n, reason: 'reserved' }
  }

  return { safe: true, normalised: n }
}
