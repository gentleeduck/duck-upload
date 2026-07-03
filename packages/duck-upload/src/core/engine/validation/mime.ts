import type { Contracts } from '../../contracts'
import { __mimeWarnings, mimeMatches, sniffMime } from '../../utils/mime-sniff'

/**
 * Cross-check the claimed `file.type` against the file's magic bytes. Reads the
 * first 16 bytes only (the longest signature {@link sniffMime} handles is 12).
 *
 * @returns A `mime_mismatch` reject reason when `strict` is `true` and the
 *   sniff disagrees. Returns `null` (allow) when the sniff is inconclusive, the
 *   claim matches, or `strict` is `false` — in the non-strict case a one-time
 *   warning is logged per mismatched pair. Empty files resolve to `null`.
 */
export async function validateMimeSignature(
  file: File,
  strict: boolean,
): Promise<Contracts.Validation.Rejection | null> {
  if (file.size === 0) return null
  // 16 bytes covers every recognised signature (longest is 12).
  const head = await file.slice(0, 16).arrayBuffer()
  const sniffed = sniffMime(new Uint8Array(head))
  if (sniffed === null) return null
  const claimed = file.type || ''
  if (mimeMatches(claimed, sniffed)) return null

  if (strict) {
    return { code: 'mime_mismatch', claimed: claimed || '<empty>', sniffed }
  }

  const key = `${claimed || '<empty>'}::${sniffed}`
  if (!__mimeWarnings.has(key)) {
    __mimeWarnings.add(key)
    // Filename is omitted from the warning: it is untrusted input.
    console.warn(
      `[duck-upload] MIME mismatch: claimed "${claimed || '<empty>'}" but bytes look like "${sniffed}". ` +
        'Set `strictMimeMatch: true` to reject these files.',
    )
  }
  return null
}
