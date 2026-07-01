import { UploadEngineError } from '../../errors'
import { isRecord } from '../../utils/guards'

/**
 * Validates the structure and properties of an upload intent returned from the backend.
 *
 * Ensures all required fields are present and valid for the specified strategy.
 *
 * @param intent - The intent payload to validate.
 * @param strategy - The strategy discriminant matching the intent.
 * @returns An `UploadEngineError` if invalid, or `null` if the intent is well-formed.
 */
export function validateIntent(intent: unknown, strategy: string): UploadEngineError | null {
  if (!isRecord(intent)) {
    return new UploadEngineError('validation_failed', { message: 'Invalid intent: must be an object' })
  }

  // Check required fields
  if (typeof intent['strategy'] !== 'string') {
    return new UploadEngineError('validation_failed', { message: 'Invalid intent: missing or invalid strategy field' })
  }

  if (intent['strategy'] !== strategy) {
    return new UploadEngineError('validation_failed', {
      message: `Invalid intent: strategy mismatch (expected ${strategy}, got ${intent['strategy']})`,
    })
  }

  if (typeof intent['fileId'] !== 'string' || !intent['fileId']) {
    return new UploadEngineError('validation_failed', { message: 'Invalid intent: missing or invalid fileId' })
  }

  // Strategy-specific validation
  if (strategy === 'post') {
    // POST strategy requires url and fields
    if (typeof intent['url'] !== 'string' || !intent['url']) {
      return new UploadEngineError('validation_failed', { message: 'Invalid post intent: missing or invalid url' })
    }
    try {
      const url = new URL(intent['url'] as string)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return new UploadEngineError('validation_failed', {
          message: 'Invalid post intent: url must use http or https protocol',
        })
      }
    } catch {
      return new UploadEngineError('validation_failed', { message: 'Invalid post intent: url is not a valid URL' })
    }
    if (!intent['fields'] || typeof intent['fields'] !== 'object') {
      return new UploadEngineError('validation_failed', { message: 'Invalid post intent: missing or invalid fields' })
    }
  } else if (strategy === 'multipart') {
    // Multipart strategy requires uploadId and partSize
    if (typeof intent['uploadId'] !== 'string' || !intent['uploadId']) {
      return new UploadEngineError('validation_failed', {
        message: 'Invalid multipart intent: missing or invalid uploadId',
      })
    }
    if (typeof intent['partSize'] !== 'number' || intent['partSize'] <= 0) {
      return new UploadEngineError('validation_failed', {
        message: 'Invalid multipart intent: missing or invalid partSize',
      })
    }
    // Parts array is optional (can be fetched later)
    if ('parts' in intent && intent['parts'] !== undefined) {
      if (!Array.isArray(intent['parts'])) {
        return new UploadEngineError('validation_failed', {
          message: 'Invalid multipart intent: parts must be an array if provided',
        })
      }
    }
  }

  return null
}
