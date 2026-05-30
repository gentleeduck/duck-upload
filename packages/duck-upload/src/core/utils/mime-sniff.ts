/**
 * Magic-byte MIME sniffer.
 *
 * SEC-004: `File.type` is client-claimed and trivially spoofable (the
 * browser populates it from extension or the user-side drag source - a
 * server cannot trust it). This module inspects the first ~12 bytes of a
 * file and returns the actual format, so the validator can cross-check
 * the claimed `file.type` against the byte signature.
 *
 * Only common, unambiguous formats are recognised. Returning `null` means
 * "unknown" - callers should treat unknown as *not a mismatch* (defense-in-
 * depth, not a deny-list).
 */

/**
 * Inspect the first bytes of `bytes` and return the canonical MIME type
 * for the format if recognised, or `null` if unknown.
 *
 * 12 bytes is sufficient for every signature handled here; callers may
 * pass a longer slice but anything beyond byte 11 is ignored.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const n = bytes.length

  // JPEG: FF D8 FF
  if (n >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    n >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }

  // GIF: 47 49 46 38 ("GIF8")
  if (n >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif'
  }

  // PDF: 25 50 44 46 ("%PDF")
  if (n >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf'
  }

  // WebP: bytes 0-3 = "RIFF" and bytes 8-11 = "WEBP"
  if (
    n >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  // MP4 / ISO BMFF: bytes 4-7 = "ftyp"
  if (n >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4'
  }

  // WebM / Matroska EBML header: 1A 45 DF A3
  if (n >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm'
  }

  // ZIP-family (DOCX/XLSX/PPTX/APK/JAR/EPUB share this): 50 4B 03 04
  if (n >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'application/zip'
  }

  // MP3: ID3v2 tag (49 44 33) or MPEG frame sync (FF FB / FF F3 / FF F2)
  if (n >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg'
  }
  if (n >= 2 && bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)) {
    return 'audio/mpeg'
  }

  return null
}

/**
 * Compare a sniffed MIME type against a claimed one. Returns `true` when
 * they refer to the same format, `false` on conflict. `null` sniff is
 * always treated as a match (unknown formats are not a deny condition).
 *
 * Comparison is loose by design - `image/jpg` vs `image/jpeg`, ZIP-based
 * Office formats vs `application/zip`, etc. all need to be tolerated.
 */
export function mimeMatches(claimed: string, sniffed: string | null): boolean {
  if (!sniffed) return true
  const c = claimed.toLowerCase().trim()
  const s = sniffed.toLowerCase().trim()
  if (c === s) return true
  if (c === '' || c === 'application/octet-stream') return true

  // Tolerate ZIP-based document formats - the magic bytes only say "this
  // is a ZIP container", which is the truthful low-level answer. Any
  // claimed Office / OpenDocument / JAR / APK / EPUB type is consistent.
  if (s === 'application/zip') {
    if (
      c.startsWith('application/vnd.openxmlformats-officedocument.') ||
      c.startsWith('application/vnd.oasis.opendocument.') ||
      c === 'application/epub+zip' ||
      c === 'application/java-archive' ||
      c === 'application/vnd.android.package-archive'
    ) {
      return true
    }
  }

  // JPEG common aliases.
  if (s === 'image/jpeg' && (c === 'image/jpg' || c === 'image/pjpeg')) return true

  return false
}

/** Module-level dedup set for one-time-per-session warnings. @internal */
export const __mimeWarnings = new Set<string>()
