/**
 * SEC-005: filename normalisation and reserved-name blacklist.
 *
 * User-supplied filenames flow into:
 * - storage backends (object keys / file paths),
 * - HTTP request lines and headers (multipart `filename=`),
 * - the consumer's UI (rendered as text or, worse, HTML),
 * - shell-tool arguments if a backend operator pipes them around.
 *
 * Each of those sinks has its own rules. This module enforces the
 * *intersection* of the most common dangers, in order:
 *
 *   1. Unicode NFKC normalisation - collapse compatibility forms so
 *      bidi-override + width-spoofing tricks do not bypass deny-lists.
 *   2. Strip control characters (`< 0x20` or `0x7F`) - they break
 *      multipart parsers and can be used to smuggle CR/LF into headers.
 *   3. Strip a leading `-` - many CLI tools interpret leading-dash
 *      arguments as flags (`-rm-rf.txt`).
 *   4. Strip trailing `.` and trailing space - silently dropped by
 *      Windows; `file.txt ` and `file.txt` would collide on extract.
 *   5. Reject reserved Windows device names (CON, PRN, AUX, NUL,
 *      COM1-COM9, LPT1-LPT9) regardless of extension.
 *   6. Reject names > 255 chars (POSIX/NTFS practical limit).
 *   7. Reject path separators - a filename must never contain `/` or
 *      `\`. Path-joining belongs on a higher layer.
 *   8. Reject empty results - a name that vanished into sanitisation
 *      cannot be safely used.
 */

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
 * Apply the SEC-005 pipeline to `name`. The result is either
 * `{ safe: true, normalised }` ready to forward to a backend, or
 * `{ safe: false, normalised, reason }` carrying the partial cleanup
 * for diagnostics.
 *
 * The function is pure and synchronous.
 */
export function sanitizeFilename(name: string): SanitizeFilenameResult {
  // 1) NFKC normalise.
  let n = name.normalize('NFKC')

  // 2) Strip control + DEL.
  n = stripControlChars(n)

  // 3) Strip a leading `-`.
  while (n.startsWith('-')) n = n.slice(1)

  // 4) Strip trailing `.` and trailing space (Windows behaviour).
  while (n.length > 0 && (n.endsWith('.') || n.endsWith(' '))) n = n.slice(0, -1)

  // 8) Empty after sanitisation.
  if (n.length === 0) {
    return { safe: false, normalised: n, reason: 'empty' }
  }

  // 7) Path separators must never reach here.
  if (n.includes('/') || n.includes('\\')) {
    return { safe: false, normalised: n, reason: 'path-sep' }
  }

  // 6) Length cap.
  if (n.length > 255) {
    return { safe: false, normalised: n, reason: 'too-long' }
  }

  // 5) Reserved Windows device names - match the *base* (before the
  //    final dot), case-insensitive. `CON.txt`, `nul`, `COM1.tar.gz`
  //    all reject.
  const dot = n.indexOf('.')
  const base = (dot === -1 ? n : n.slice(0, dot)).toUpperCase()
  if (RESERVED_WINDOWS_NAMES.has(base)) {
    return { safe: false, normalised: n, reason: 'reserved' }
  }

  return { safe: true, normalised: n }
}
