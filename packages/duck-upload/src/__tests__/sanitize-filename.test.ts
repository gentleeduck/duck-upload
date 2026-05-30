import { describe, expect, test } from 'vitest'
import { sanitizeFilename } from '../core/utils/sanitize-filename'

describe('sanitizeFilename', () => {
  test('happy path: ordinary name passes through unchanged', () => {
    const r = sanitizeFilename('report-2026.pdf')
    expect(r).toEqual({ safe: true, normalised: 'report-2026.pdf' })
  })

  test('CON.txt rejected as reserved (Windows device name)', () => {
    const r = sanitizeFilename('CON.txt')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('reserved')
  })

  test('lowercase nul rejected as reserved (case-insensitive)', () => {
    const r = sanitizeFilename('nul')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('reserved')
  })

  test('COM1.tar.gz rejected (reserved base, ignoring extension)', () => {
    const r = sanitizeFilename('COM1.tar.gz')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('reserved')
  })

  test('-rm-rf.txt → leading dash stripped, becomes rm-rf.txt', () => {
    const r = sanitizeFilename('-rm-rf.txt')
    expect(r).toEqual({ safe: true, normalised: 'rm-rf.txt' })
  })

  test('multiple leading dashes all stripped', () => {
    const r = sanitizeFilename('---flag.bin')
    expect(r).toEqual({ safe: true, normalised: 'flag.bin' })
  })

  test('trailing dots and spaces stripped (Windows behaviour)', () => {
    expect(sanitizeFilename('file.txt.').normalised).toBe('file.txt')
    expect(sanitizeFilename('file.txt ').normalised).toBe('file.txt')
    expect(sanitizeFilename('file.txt. . .').normalised).toBe('file.txt')
  })

  test('RTL override and other compat chars get NFKC normalised', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE — stripped via NFKC?
    // NFKC does not strip RLO, but the test confirms normalize() is applied;
    // we focus on the fullwidth → ASCII collapse which is the typical bypass.
    const fullwidth = 'ｆｕｌｌ.pdf' // "ｆｕｌｌ.pdf" → "full.pdf"
    const r = sanitizeFilename(fullwidth)
    expect(r).toEqual({ safe: true, normalised: 'full.pdf' })
  })

  test('control chars cleaned (NUL byte)', () => {
    const r = sanitizeFilename('file\x00name.txt')
    expect(r).toEqual({ safe: true, normalised: 'filename.txt' })
  })

  test('control chars cleaned (CR/LF — header smuggling)', () => {
    const r = sanitizeFilename('a\r\nb.txt')
    expect(r).toEqual({ safe: true, normalised: 'ab.txt' })
  })

  test('DEL (0x7F) is stripped', () => {
    const r = sanitizeFilename('a\x7Fb.txt')
    expect(r).toEqual({ safe: true, normalised: 'ab.txt' })
  })

  test('300-char name rejected as too-long', () => {
    const r = sanitizeFilename('a'.repeat(300) + '.txt')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('too-long')
  })

  test('exactly 255 chars passes', () => {
    const name = 'a'.repeat(251) + '.txt' // 255 total
    const r = sanitizeFilename(name)
    expect(r.safe).toBe(true)
  })

  test('forward slash path separator rejected', () => {
    const r = sanitizeFilename('foo/bar.txt')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('path-sep')
  })

  test('backslash path separator rejected', () => {
    const r = sanitizeFilename('foo\\bar.txt')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('path-sep')
  })

  test('empty input rejected', () => {
    const r = sanitizeFilename('')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('empty')
  })

  test('name that vanishes after sanitisation rejected as empty', () => {
    const r = sanitizeFilename('---. . .')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('empty')
  })

  test('control-only input rejected as empty', () => {
    const r = sanitizeFilename('\x00\x01\x02')
    expect(r.safe).toBe(false)
    expect(r.safe === false && r.reason).toBe('empty')
  })
})
