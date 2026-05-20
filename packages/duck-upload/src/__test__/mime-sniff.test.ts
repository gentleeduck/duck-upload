import { beforeEach, describe, expect, test, vi } from 'vitest'
import { validateMimeSignature } from '../core/engine/validation/mime'
import { __mimeWarnings, mimeMatches, sniffMime } from '../core/utils/mime-sniff'

function bytes(...arr: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(arr)
}

describe('sniffMime', () => {
  test('detects JPEG (FF D8 FF)', () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg')
  })

  test('detects PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
  })

  test('detects GIF (47 49 46 38)', () => {
    expect(sniffMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif')
  })

  test('detects PDF (%PDF)', () => {
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34))).toBe('application/pdf')
  })

  test('detects ZIP family (PK..)', () => {
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00))).toBe('application/zip')
  })

  test('detects MP4 ftyp box', () => {
    expect(sniffMime(bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toBe('video/mp4')
  })

  test('detects WebP (RIFF....WEBP)', () => {
    expect(sniffMime(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp')
  })

  test('detects WebM/Matroska', () => {
    expect(sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42))).toBe('video/webm')
  })

  test('detects MP3 ID3 tag', () => {
    expect(sniffMime(bytes(0x49, 0x44, 0x33, 0x04, 0x00, 0x00))).toBe('audio/mpeg')
  })

  test('detects MP3 raw frame sync (FF FB)', () => {
    expect(sniffMime(bytes(0xff, 0xfb, 0x90, 0x00))).toBe('audio/mpeg')
  })

  test('returns null on unknown bytes', () => {
    expect(sniffMime(bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b))).toBeNull()
  })

  test('returns null on too-short buffers', () => {
    expect(sniffMime(bytes(0xff))).toBeNull()
  })
})

describe('mimeMatches', () => {
  test('null sniff is always a match (unknown is not deny)', () => {
    expect(mimeMatches('image/jpeg', null)).toBe(true)
  })

  test('exact match', () => {
    expect(mimeMatches('image/jpeg', 'image/jpeg')).toBe(true)
  })

  test('empty / octet-stream claim is always a match (no claim made)', () => {
    expect(mimeMatches('', 'image/jpeg')).toBe(true)
    expect(mimeMatches('application/octet-stream', 'application/pdf')).toBe(true)
  })

  test('JPEG common aliases', () => {
    expect(mimeMatches('image/jpg', 'image/jpeg')).toBe(true)
    expect(mimeMatches('image/pjpeg', 'image/jpeg')).toBe(true)
  })

  test('Office DOCX is consistent with ZIP signature', () => {
    expect(
      mimeMatches('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'),
    ).toBe(true)
  })

  test('JPEG bytes with claimed PDF type — mismatch', () => {
    expect(mimeMatches('application/pdf', 'image/jpeg')).toBe(false)
  })
})

describe('validateMimeSignature', () => {
  beforeEach(() => {
    __mimeWarnings.clear()
  })

  test('JPEG bytes with claimed PDF type → rejected when strict', async () => {
    const file = new File([bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)], 'evil.pdf', { type: 'application/pdf' })
    const reason = await validateMimeSignature(file, true)
    expect(reason).toEqual({ code: 'mime_mismatch', claimed: 'application/pdf', sniffed: 'image/jpeg' })
  })

  test('JPEG bytes with claimed PDF type → null + console.warn when not strict', async () => {
    const file = new File([bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)], 'evil.pdf', { type: 'application/pdf' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reason = await validateMimeSignature(file, false)
    expect(reason).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0] ?? '')).toMatch(/MIME mismatch/)
    // Filename MUST NOT appear in the warning (SEC-003 — tainted input).
    expect(String(warnSpy.mock.calls[0]?.[0] ?? '')).not.toMatch(/evil\.pdf/)
    warnSpy.mockRestore()
  })

  test('repeated identical mismatches only warn once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 3; i++) {
      const file = new File([bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)], `f-${i}.pdf`, { type: 'application/pdf' })
      await validateMimeSignature(file, false)
    }
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  test('matching JPEG+JPEG → accepted', async () => {
    const file = new File([bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)], 'ok.jpg', { type: 'image/jpeg' })
    expect(await validateMimeSignature(file, true)).toBeNull()
  })

  test('unknown bytes → accepted (sniff returns null, no mismatch)', async () => {
    const file = new File(
      [bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b)],
      'mystery.dat',
      {
        type: 'application/pdf',
      },
    )
    expect(await validateMimeSignature(file, true)).toBeNull()
  })

  test('empty file → null (defers to other validators)', async () => {
    const file = new File([], 'empty.bin')
    expect(await validateMimeSignature(file, true)).toBeNull()
  })
})
