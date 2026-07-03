import { describe, expect, test } from 'vitest'
import { fileMatchesAccept, matchesAcceptToken, selectFiles } from '../use-dropzone'

function f(name: string, type = ''): File {
  return new File(['x'], name, { type })
}

describe('matchesAcceptToken', () => {
  test('extension token (case-insensitive)', () => {
    expect(matchesAcceptToken(f('photo.PNG'), '.png')).toBe(true)
    expect(matchesAcceptToken(f('doc.pdf'), '.png')).toBe(false)
  })

  test('exact MIME token', () => {
    expect(matchesAcceptToken(f('a', 'image/png'), 'image/png')).toBe(true)
    expect(matchesAcceptToken(f('a', 'image/jpeg'), 'image/png')).toBe(false)
  })

  test('MIME wildcard token', () => {
    expect(matchesAcceptToken(f('a', 'image/jpeg'), 'image/*')).toBe(true)
    expect(matchesAcceptToken(f('a', 'video/mp4'), 'image/*')).toBe(false)
  })

  test('empty/whitespace token never matches', () => {
    expect(matchesAcceptToken(f('a', 'image/png'), '   ')).toBe(false)
  })
})

describe('fileMatchesAccept', () => {
  test('absent or empty accept passes everything', () => {
    expect(fileMatchesAccept(f('a', 'application/zip'))).toBe(true)
    expect(fileMatchesAccept(f('a', 'application/zip'), '')).toBe(true)
    expect(fileMatchesAccept(f('a', 'application/zip'), ' , ')).toBe(true)
  })

  test('matches when any token matches', () => {
    expect(fileMatchesAccept(f('a.pdf', 'application/pdf'), 'image/*,.pdf')).toBe(true)
    expect(fileMatchesAccept(f('a.png', 'image/png'), 'image/*,.pdf')).toBe(true)
    expect(fileMatchesAccept(f('a.txt', 'text/plain'), 'image/*,.pdf')).toBe(false)
  })
})

describe('selectFiles', () => {
  const files = [f('a.png', 'image/png'), f('b.txt', 'text/plain'), f('c.jpg', 'image/jpeg')]

  test('filters by accept', () => {
    const out = selectFiles(files, { accept: 'image/*' })
    expect(out.map((x) => x.name)).toEqual(['a.png', 'c.jpg'])
  })

  test('collapses to one when multiple is false', () => {
    const out = selectFiles(files, { accept: 'image/*', multiple: false })
    expect(out.map((x) => x.name)).toEqual(['a.png'])
  })

  test('keeps all when multiple omitted (defaults to many)', () => {
    const out = selectFiles(files, {})
    expect(out).toHaveLength(3)
  })

  test('empty when nothing matches', () => {
    expect(selectFiles(files, { accept: 'video/*' })).toEqual([])
  })
})
