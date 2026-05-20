import type { RejectReason } from '../../contracts'
import { __mimeWarnings, mimeMatches, sniffMime } from '../../utils/mime-sniff'

/**
 * SEC-004: cross-check the claimed `file.type` against the file's magic
 * bytes. Reads the first 16 bytes only (the longest signature handled by
 * {@link sniffMime} is 12 bytes; 16 is a small safety margin).
 *
 * @returns A `mime_mismatch` reject reason when `strict` is `true` and
 *   the sniff disagrees. Returns `null` (allow) when the sniff returns
 *   `null` (unknown), when the claim matches, or when `strict` is `false`
 *   (in which case a one-time-per-mismatched-pair `console.warn` is
 *   emitted as defense-in-depth telemetry).
 *
 * Files smaller than 1 byte (already rejected by `validateFile` upstream)
 * resolve to `null` here for safety.
 */
export async function validateMimeSignature(file: File, strict: boolean): Promise<RejectReason | null> {
  if (file.size === 0) return null
  // 16 bytes is enough — every signature we recognise fits in 12.
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
    // Note: filename intentionally NOT included (SEC-003 — tainted input).
    console.warn(
      `[duck-upload] MIME mismatch: claimed "${claimed || '<empty>'}" but bytes look like "${sniffed}". ` +
        'Set `strictMimeMatch: true` to reject these files.',
    )
  }
  return null
}
