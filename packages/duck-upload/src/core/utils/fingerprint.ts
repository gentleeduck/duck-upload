import type { FileFingerprint } from '../contracts'

/**
 * Builds a lightweight fingerprint from a {@link File}.
 *
 * MIME is normalized: parameters after `;` are stripped (Bun's File
 * constructor appends `;charset=utf-8` to text/* types; browsers send
 * the bare MIME via FormData). Persisted fingerprints stay portable
 * across runtimes.
 */
export function computeFingerprint(file: File): FileFingerprint {
  return {
    name: file.name,
    size: file.size,
    type: normalizeMime(file.type),
    lastModified: file.lastModified,
  }
}

function normalizeMime(mime: string): string {
  const semi = mime.indexOf(';')
  return semi === -1 ? mime.trim() : mime.slice(0, semi).trim()
}

/**
 * `type` is intentionally NOT compared: a re-picked file with the same
 * bytes but a different runtime-inferred MIME is still the same file.
 */
export function fingerprintMatches(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}
