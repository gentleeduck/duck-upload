import { describe, expect, test } from 'vitest'
import { validateIntent } from '../intent'

describe('validateIntent - base shape', () => {
  test('rejects non-object', () => {
    expect(validateIntent(null, 'post')?.message).toMatch(/must be an object/)
    expect(validateIntent('str', 'post')?.message).toMatch(/must be an object/)
  })
  test('rejects missing strategy', () => {
    expect(validateIntent({}, 'post')?.message).toMatch(/missing or invalid strategy/)
  })
  test('rejects strategy mismatch', () => {
    expect(validateIntent({ strategy: 'multipart' }, 'post')?.message).toMatch(/strategy mismatch/)
  })
  test('rejects missing fileId', () => {
    expect(validateIntent({ strategy: 'post' }, 'post')?.message).toMatch(/missing or invalid fileId/)
  })
})

describe('validateIntent - post', () => {
  const base = { strategy: 'post', fileId: 'f1', fields: {} }
  test('rejects file://', () => {
    expect(validateIntent({ ...base, url: 'file:///x' }, 'post')?.message).toMatch(/url must use http/)
  })
  test('rejects malformed url', () => {
    expect(validateIntent({ ...base, url: 'not a url' }, 'post')?.message).toMatch(/not a valid URL/)
  })
  test('accepts well-formed', () => {
    expect(validateIntent({ ...base, url: 'https://x.example/up' }, 'post')).toBeNull()
  })
  test('rejects non-object fields', () => {
    expect(validateIntent({ ...base, url: 'https://x.example/up', fields: 'bad' }, 'post')?.message).toMatch(/fields/)
  })
})

describe('validateIntent - multipart NaN-bypass defense', () => {
  const base = { strategy: 'multipart', fileId: 'f1', uploadId: 'u1' }

  test('rejects NaN partSize', () => {
    expect(validateIntent({ ...base, partSize: Number.NaN }, 'multipart')?.message).toMatch(/partSize/)
  })
  test('rejects Infinity partSize', () => {
    expect(validateIntent({ ...base, partSize: Number.POSITIVE_INFINITY }, 'multipart')?.message).toMatch(/partSize/)
  })
  test('rejects zero partSize', () => {
    expect(validateIntent({ ...base, partSize: 0 }, 'multipart')?.message).toMatch(/partSize/)
  })
  test('rejects negative partSize', () => {
    expect(validateIntent({ ...base, partSize: -1 }, 'multipart')?.message).toMatch(/partSize/)
  })
  test('rejects string partSize', () => {
    expect(validateIntent({ ...base, partSize: '5' }, 'multipart')?.message).toMatch(/partSize/)
  })
  test('accepts finite positive partSize', () => {
    expect(validateIntent({ ...base, partSize: 5_242_880 }, 'multipart')).toBeNull()
  })
})

describe('validateIntent - multipart parts array', () => {
  const base = { strategy: 'multipart', fileId: 'f1', uploadId: 'u1', partSize: 5_242_880 }
  test('omits parts -> accepted', () => {
    expect(validateIntent(base, 'multipart')).toBeNull()
  })
  test('parts as object -> rejected', () => {
    expect(validateIntent({ ...base, parts: { 1: 'x' } }, 'multipart')?.message).toMatch(/parts/)
  })
  test('parts as array -> accepted', () => {
    expect(validateIntent({ ...base, parts: [] }, 'multipart')).toBeNull()
  })
})
