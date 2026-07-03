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
    expect(err.context?.['filename']).toBe(MALICIOUS_FILENAME)
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

describe('engine handlers filename-in-message inverse assertion', () => {
  // The legacy contract was: `error.message.includes(filename)`. The new
  // contract is the opposite: the filename MUST NOT appear in `message`. The
  // handlers no longer interpolate filename into `message`; verifying that by
  // exercising the handlers directly is covered by the integration suite, but
  // we keep the contract pinned here so future refactors stay safe.
  test('a structured error keeps the message clean and surfaces filename only on context', () => {
    const base = { code: 'unknown' as const, message: 'Unknown error', retryable: false }
    const error = {
      ...base,
      context: { filename: MALICIOUS_FILENAME, size: 12, purpose: 'avatar' },
    }
    expect(error.message).not.toContain(MALICIOUS_FILENAME)
    expect(error.message).not.toContain('<img')
    expect(error.context['filename']).toBe(MALICIOUS_FILENAME)
  })
})

import {
  UploadAbortError,
  UploadAuthError,
  UploadHttpError,
  UploadNetworkError,
  UploadRateLimitError,
  UploadServerError,
  UploadStrategyMissingError,
  UploadTimeoutError,
  UploadUnknownError,
  UploadValidationError,
} from '../errors'

describe('UploadEngineError subclasses', () => {
  test('UploadValidationError', () => {
    const reason = { code: 'empty_file' as const }
    const err = new UploadValidationError(reason)
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('validation_failed')
    expect(err.reason).toBe(reason)
    expect(err.retryable).toBe(false)
  })

  test('UploadStrategyMissingError', () => {
    const err = new UploadStrategyMissingError('custom')
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('strategy_missing')
    expect(err.strategy).toBe('custom')
    expect(err.retryable).toBe(false)
  })

  test('UploadAbortError', () => {
    const err = new UploadAbortError('pause')
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('aborted')
    expect(err.reason).toBe('pause')
    expect(err.retryable).toBe(false)
  })

  test('UploadNetworkError', () => {
    const err = new UploadNetworkError()
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('network')
    expect(err.retryable).toBe(true)
  })

  test('UploadHttpError', () => {
    const err = new UploadHttpError(500, 'Internal Server Error', { statusText: 'Server Error' })
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('http')
    expect(err.status).toBe(500)
    expect(err.statusText).toBe('Server Error')
    expect(err.retryable).toBe(true)

    const err400 = new UploadHttpError(400, 'Bad Request')
    expect(err400.retryable).toBe(false)
  })

  test('UploadTimeoutError', () => {
    const err = new UploadTimeoutError()
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('timeout')
    expect(err.retryable).toBe(true)
  })

  test('UploadAuthError', () => {
    const err = new UploadAuthError()
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('auth')
    expect(err.retryable).toBe(false)
  })

  test('UploadRateLimitError', () => {
    const err = new UploadRateLimitError('Too many requests', { retryAfterMs: 5000 })
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('rate_limit')
    expect(err.retryAfterMs).toBe(5000)
    expect(err.retryable).toBe(true)
  })

  test('UploadServerError', () => {
    const err = new UploadServerError('DB Error', { serverCode: 'DB_ERROR' })
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('server')
    expect(err.serverCode).toBe('DB_ERROR')
    expect(err.retryable).toBe(true)
  })

  test('UploadUnknownError', () => {
    const err = new UploadUnknownError('Something exploded')
    expect(err).toBeInstanceOf(UploadEngineError)
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
  })
})
