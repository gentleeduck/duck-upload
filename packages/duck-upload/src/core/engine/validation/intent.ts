import { isRecord } from '../../utils/guards'

function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

export function validateIntent(intent: unknown, strategy: string): Error | null {
  if (!isRecord(intent)) {
    return new Error('Invalid intent: must be an object')
  }

  if (typeof intent.strategy !== 'string') {
    return new Error('Invalid intent: missing or invalid strategy field')
  }

  if (intent.strategy !== strategy) {
    return new Error(`Invalid intent: strategy mismatch (expected ${strategy}, got ${intent.strategy})`)
  }

  if (typeof intent.fileId !== 'string' || !intent.fileId) {
    return new Error('Invalid intent: missing or invalid fileId')
  }

  if (strategy === 'post') {
    if (typeof intent.url !== 'string' || !intent.url) {
      return new Error('Invalid post intent: missing or invalid url')
    }
    try {
      const url = new URL(intent.url)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return new Error('Invalid post intent: url must use http or https protocol')
      }
    } catch {
      return new Error('Invalid post intent: url is not a valid URL')
    }
    if (!intent.fields || typeof intent.fields !== 'object') {
      return new Error('Invalid post intent: missing or invalid fields')
    }
  } else if (strategy === 'multipart') {
    if (typeof intent.uploadId !== 'string' || !intent.uploadId) {
      return new Error('Invalid multipart intent: missing or invalid uploadId')
    }
    // NaN-bypass defense: typeof NaN === 'number' AND NaN > 0 is false, so the
    // prior `intent.partSize <= 0` check let NaN through. isFinitePositive rejects it.
    if (!isFinitePositive(intent.partSize)) {
      return new Error('Invalid multipart intent: missing or invalid partSize')
    }
    if ('parts' in intent && intent.parts !== undefined) {
      if (!Array.isArray(intent.parts)) {
        return new Error('Invalid multipart intent: parts must be an array if provided')
      }
    }
  }

  return null
}
