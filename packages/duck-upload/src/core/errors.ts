import type { Contracts } from './contracts'

/**
 * Structured extra context properties for upload errors.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export type UploadErrorContext = Record<string, unknown>

const STATIC_MESSAGES: Record<string, string> = {
  intent_failed: 'upload intent request failed',
  upload_failed: 'upload transfer failed',
  complete_failed: 'upload finalize failed',
  validation_failed: 'file validation failed',
  strategy_missing: 'upload strategy not found',
  aborted: 'upload aborted',
  network: 'network error occurred',
  http: 'http request failed',
  timeout: 'request timed out',
  auth: 'authentication failed',
  rate_limit: 'rate limit exceeded',
  server: 'server error occurred',
  unknown: 'unknown upload error',
}

/**
 * Base typed error thrown by the upload engine.
 *
 * Always carries a stable error classification `code` and an immutable, static
 * `message`. Attic strings (like raw input details) live under `context` or subclass-specific fields.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadEngineError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string
  /** Structured context details. */
  readonly context?: UploadErrorContext
  /** Original error, if any, mapped per ES2022. */
  override readonly cause?: unknown
  /** Flag specifying whether the error recovery system should schedule retries. */
  readonly retryable: boolean

  constructor(
    code: string,
    init?: {
      message?: string | undefined
      context?: UploadErrorContext | undefined
      cause?: unknown
      retryable?: boolean | undefined
    },
  ) {
    const msg = init?.message ?? STATIC_MESSAGES[code] ?? `upload error (${code})`
    super(msg)
    this.name = 'UploadEngineError'
    this.code = code
    this.retryable = init?.retryable ?? false
    if (init?.context) this.context = init.context
    if (init?.cause !== undefined) this.cause = init.cause
  }
}

/**
 * Error thrown when file validation rules fail.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadValidationError extends UploadEngineError {
  /** Structured rejection reason details. */
  readonly reason: Contracts.Validation.Rejection

  constructor(
    reason: Contracts.Validation.Rejection,
    message?: string,
    init?: { cause?: unknown; context?: UploadErrorContext },
  ) {
    super('validation_failed', {
      message: message ?? `File validation failed: ${reason.code}`,
      retryable: false,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadValidationError'
    this.reason = reason
  }
}

/**
 * Error thrown when an upload strategy identifier is not registered.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadStrategyMissingError extends UploadEngineError {
  /** Unregistered strategy identifier. */
  readonly strategy: string

  constructor(strategy: string, message?: string, init?: { cause?: unknown; context?: UploadErrorContext }) {
    super('strategy_missing', {
      message: message ?? `Upload strategy "${strategy}" is not registered`,
      retryable: false,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadStrategyMissingError'
    this.strategy = strategy
  }
}

/**
 * Error thrown when an upload is aborted (paused or canceled).
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadAbortError extends UploadEngineError {
  /** Reason context for the abort. */
  readonly reason: 'pause' | 'cancel' | 'unknown'

  constructor(
    reason: 'pause' | 'cancel' | 'unknown',
    message?: string,
    init?: { cause?: unknown; context?: UploadErrorContext },
  ) {
    super('aborted', {
      message: message ?? 'Upload aborted',
      retryable: false,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadAbortError'
    this.reason = reason
  }
}

/**
 * Error thrown on transport-level connection or fetch failures.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadNetworkError extends UploadEngineError {
  constructor(message?: string, init?: { cause?: unknown; context?: UploadErrorContext }) {
    super('network', {
      message: message ?? 'Network error occurred',
      retryable: true,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadNetworkError'
  }
}

/**
 * Error thrown when a non-2xx HTTP status response is returned.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadHttpError extends UploadEngineError {
  /** HTTP response status code. */
  readonly status: number
  /** HTTP response status text message. */
  readonly statusText?: string

  constructor(
    status: number,
    message?: string,
    init?: {
      statusText?: string | undefined
      cause?: unknown
      context?: UploadErrorContext | undefined
      retryable?: boolean | undefined
    },
  ) {
    const isRetryable = init?.retryable ?? (status >= 500 || status === 429)
    super('http', {
      message: message ?? `HTTP request failed with status ${status}`,
      retryable: isRetryable,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadHttpError'
    this.status = status
    if (init?.statusText) this.statusText = init.statusText
  }
}

/**
 * Error thrown when a timeout occurs during network operations.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadTimeoutError extends UploadEngineError {
  constructor(message?: string, init?: { cause?: unknown; context?: UploadErrorContext }) {
    super('timeout', {
      message: message ?? 'Request timed out',
      retryable: true,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadTimeoutError'
  }
}

/**
 * Error thrown on authentication / authorization failures.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadAuthError extends UploadEngineError {
  constructor(message?: string, init?: { cause?: unknown; context?: UploadErrorContext }) {
    super('auth', {
      message: message ?? 'Authentication failed',
      retryable: false,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadAuthError'
  }
}

/**
 * Error thrown when the endpoint indicates rate limits are exceeded.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadRateLimitError extends UploadEngineError {
  /** Optional delay value recommended by the server before retry. */
  readonly retryAfterMs?: number

  constructor(message?: string, init?: { retryAfterMs?: number; cause?: unknown; context?: UploadErrorContext }) {
    super('rate_limit', {
      message: message ?? 'Rate limit exceeded',
      retryable: true,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadRateLimitError'
    if (init?.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs
  }
}

/**
 * Error thrown when custom backend/server validation errors are reported.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadServerError extends UploadEngineError {
  /** Server-defined diagnostic code. */
  readonly serverCode?: string

  constructor(message?: string, init?: { serverCode?: string; cause?: unknown; context?: UploadErrorContext }) {
    super('server', {
      message: message ?? 'Server error occurred',
      retryable: true,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadServerError'
    if (init?.serverCode) this.serverCode = init.serverCode
  }
}

/**
 * Fallback error class for unclassified or legacy throws.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export class UploadUnknownError extends UploadEngineError {
  constructor(message?: string, init?: { cause?: unknown; context?: UploadErrorContext }) {
    super('unknown', {
      message: message ?? 'Unknown upload error',
      retryable: false,
      cause: init?.cause,
      context: init?.context,
    })
    this.name = 'UploadUnknownError'
  }
}

/**
 * Runtime error stored on items and passed through engine events.
 * Plain contract shapes and {@link UploadEngineError} subclasses are both valid.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export type UploadError = Contracts.Errors.Error | UploadEngineError
