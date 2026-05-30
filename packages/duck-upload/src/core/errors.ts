/**
 * Engine-level typed error subclass.
 *
 * SEC-003: previously, error messages interpolated user-controlled values
 * (most notably `fingerprint.name`). Host apps that render `error.message`
 * with `dangerouslySetInnerHTML` or via `innerHTML` would execute filenames
 * like `<img src=x onerror=alert(1)>.png` as HTML/JS.
 *
 * {@link UploadEngineError} keeps a **static** `message` per `code` - safe to render
 * directly. All tainted, attacker-controlled values (filename, fileId, ...)
 * live on the structured {@link UploadEngineError.context} field.
 *
 * Consumer contract:
 * - `error.message` is safe for plain-text rendering. Treat as untrusted only
 *   if you pipe arbitrary `code` strings through.
 * - `error.context.*` values are **raw attacker input**. Escape before any
 *   HTML/innerHTML rendering (`textContent`, React children, or a sanitizer).
 */
export type UploadErrorContext = Record<string, unknown>

const STATIC_MESSAGES: Record<string, string> = {
  intent_failed: 'upload intent request failed',
  upload_failed: 'upload transfer failed',
  complete_failed: 'upload finalize failed',
}

/**
 * Typed error thrown by the engine's intent / upload / finalize handlers.
 *
 * Always carries a stable {@link UploadEngineError.code} and an immutable, static
 * {@link UploadEngineError.message}. Filename and other tainted strings are placed
 * in {@link UploadEngineError.context} - never in the message.
 *
 * @example
 * ```ts
 * try {
 *   await client.upload(file)
 * } catch (err) {
 *   if (err instanceof UploadEngineError) {
 *     // Safe: static, attacker-cannot-influence string.
 *     toast(err.message)
 *     // Tainted: escape before HTML rendering!
 *     log({ filename: err.context?.filename })
 *   }
 * }
 * ```
 */
export class UploadEngineError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: string
  /**
   * Structured, attacker-controlled context. **Never** safe to inject into
   * HTML without escaping.
   */
  readonly context?: UploadErrorContext
  /** Original error, if any. Kept on `cause` per ES2022. */
  readonly cause?: unknown

  constructor(code: string, init?: { context?: UploadErrorContext; cause?: unknown }) {
    super(STATIC_MESSAGES[code] ?? `upload error (${code})`)
    this.name = 'UploadEngineError'
    this.code = code
    if (init?.context) this.context = init.context
    if (init?.cause !== undefined) this.cause = init.cause
  }
}
