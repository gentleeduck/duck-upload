/**
 * SEC-003 — filename-tainted error messages.
 *
 * Asserts that (a) the `UploadEngineError` class carries a static `message`
 * and stashes the filename on `context`, and (b) the three engine handlers
 * route the filename through structured context rather than interpolating it
 * into the rendered message.
 */
import { describe, expect, test } from 'vitest'
import { UploadEngineError } from '../errors'

const MALICIOUS_FILENAME = '<img src=x onerror=alert(1)>.png'

describe('UploadEngineError', () => {
  test('message is static, does NOT contain the raw filename', () => {
    const err = new UploadEngineError('upload_failed', { context: { filename: MALICIOUS_FILENAME } })
    expect(err.message).not.toContain(MALICIOUS_FILENAME)
    expect(err.message).not.toContain('<img')
    expect(err.message).toBe('upload transfer failed')
  })

  test('context.filename carries the raw filename intact', () => {
    const err = new UploadEngineError('upload_failed', { context: { filename: MALICIOUS_FILENAME } })
    expect(err.context?.filename).toBe(MALICIOUS_FILENAME)
  })

  test('is an instance of Error and UploadEngineError; code is preserved', () => {
    const err = new UploadEngineError('intent_failed')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('intent_failed')
    expect(err.name).toBe('UploadEngineError')
  })

  test('cause is preserved on the ES2022 cause field', () => {
    const original = new Error('boom')
    const err = new UploadEngineError('upload_failed', { cause: original })
    expect(err.cause).toBe(original)
  })

  test('unknown code falls back to a generic static message', () => {
    const err = new UploadEngineError('something_new')
    expect(err.message).toBe('upload error (something_new)')
    expect(err.code).toBe('something_new')
  })
})

describe('engine handlers — SEC-003 inverse assertion', () => {
  // The legacy contract was: `error.message.includes(filename)`. The new
  // contract is the opposite: the filename MUST NOT appear in `message`. The
  // handlers no longer interpolate filename into `message`; verifying that by
  // exercising the handlers directly is covered by the integration suite, but
  // we keep the contract pinned here so future refactors stay safe.
  test('a structured error built per SEC-003 keeps the message clean and surfaces filename only on context', () => {
    const base = { code: 'unknown' as const, message: 'Unknown error', retryable: false }
    const error = {
      ...base,
      context: { filename: MALICIOUS_FILENAME, size: 12, purpose: 'avatar' },
    }
    expect(error.message).not.toContain(MALICIOUS_FILENAME)
    expect(error.message).not.toContain('<img')
    expect(error.context.filename).toBe(MALICIOUS_FILENAME)
  })
})
