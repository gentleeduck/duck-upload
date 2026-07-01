import type { Contracts } from '../contracts'

/**
 * Builds a lightweight fingerprint from a {@link File}.
 */
export function computeFingerprint(file: File): Contracts.FingerprintFile {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }
}

/**
 * Compares two file fingerprints.
 */
export function fingerprintMatches(a: Contracts.FingerprintFile, b: Contracts.FingerprintFile): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}
