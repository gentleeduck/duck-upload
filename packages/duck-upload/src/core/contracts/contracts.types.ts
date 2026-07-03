/**
 * Public contract types grouped under the `Contracts` namespace.
 *
 * Each sub-namespace owns one concern (Intent, Cursor, Result, Validation,
 * Fingerprint, Errors, Strategy, BackendApi).
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace Contracts {
  export namespace Intent {
    /** Base shape for all upload intents. */
    export type Base<K extends string = string> = {
      /** Strategy name (discriminant). */
      strategy: K
      /** Unique backend file identifier. */
      fileId: string
    }

    /** Registry of intent types mapped by strategy name. */
    export type Map = Record<string, Base<string>>

    /** Union of strategy keys for an intent map. */
    export type StrategyKey<M extends Map> = keyof M & string

    /** Union of all intent variants for an intent map. */
    export type Any<M extends Map> = M[StrategyKey<M>]
  }

  export namespace Cursor {
    /** Registry of cursor payload types mapped by strategy name. */
    export type Map<M extends Intent.Map> = Partial<Record<Intent.StrategyKey<M>, unknown>>

    /** Discriminated union of all cursor variants. */
    export type Any<C extends Record<string, unknown>> = {
      [K in keyof C & string]: {
        /** Strategy name associated with this cursor. */
        strategy: K
        /** The custom strategy-defined state needed to resume the upload. */
        value?: C[K] | undefined
      }
    }[keyof C & string]
  }

  export namespace Result {
    /** Successful upload payload returned by your backend API's complete endpoint. */
    export type Base = {
      /** Unique backend file identifier. */
      fileId: string
      /** Storage key/path or public address of the uploaded file. */
      key: string
    }
  }

  export namespace Validation {
    /** Why a file was rejected during client-side validation. */
    export type Rejection =
      | { code: 'empty_file' }
      | { code: 'file_too_large'; maxBytes: number; size: number }
      | { code: 'type_not_allowed'; allowed: string[]; got: string }
      | { code: 'too_many_files'; max: number }
      | { code: 'mime_mismatch'; claimed: string; sniffed: string }
      | { code: 'filename_rejected'; reason: 'reserved' | 'too-long' | 'empty' | 'path-sep' }
  }

  /** Deterministic identity signature of a file on the client. */
  export type FingerprintFile = {
    /** Base name of the file (excluding directory path). */
    name: string
    /** Size of the file in bytes. */
    size: number
    /** MIME type of the file. */
    type: string
    /** Timestamp when the file was last modified on disk (milliseconds since epoch). */
    lastModified: number
    /** Optional pre-computed checksum of the file (e.g. SHA-256 hex). */
    checksum?: string | undefined
  }

  export namespace Errors {
    /** Base schema for upload-related runtime errors. */
    export type Base = {
      /** Stable machine-readable error classification. */
      code: string
      /** Human-friendly message suitable for presentation in standard warning elements. */
      message: string
      /** Original thrown error or reason context if available. */
      cause?: unknown
      /** Flag specifying whether the error recovery system should schedule retries. */
      retryable?: boolean
    }

    /** Discriminant union of built-in engine failure structures. */
    export type BuiltIn =
      | { code: 'validation_failed'; message: string; reason: Validation.Rejection; retryable?: false }
      | { code: 'strategy_missing'; message: string; strategy: string; retryable?: false }
      | { code: 'aborted'; message: string; reason: 'pause' | 'cancel' | 'unknown'; cause?: unknown; retryable?: false }
      | { code: 'network'; message: string; cause?: unknown; retryable?: boolean }
      | { code: 'http'; message: string; status: number; statusText?: string; cause?: unknown; retryable?: boolean }
      | { code: 'timeout'; message: string; cause?: unknown; retryable?: boolean }
      | { code: 'auth'; message: string; cause?: unknown; retryable?: false }
      | { code: 'rate_limit'; message: string; retryAfterMs?: number; cause?: unknown; retryable?: boolean }
      | { code: 'server'; message: string; serverCode?: string; cause?: unknown; retryable?: boolean }
      | { code: 'unknown'; message: string; cause?: unknown; retryable?: boolean }

    /** The canonical error shape handled by the engine, plugins, and handlers. */
    export type Error = BuiltIn | (Base & Record<string, unknown>)
  }

  /** Validation rules applied to files on registration before intents are initiated. */
  export type ValidationRules = {
    /** Maximum number of files permitted in a single upload batch. */
    maxFiles?: number
    /** Maximum size in bytes allowed for a single file. */
    maxSizeBytes?: number
    /** Minimum size in bytes allowed for a single file. */
    minSizeBytes?: number
    /** White-list of allowed MIME types (e.g. `["image/png", "application/pdf"]`). */
    allowedTypes?: string[]
    /** White-list of allowed file extension strings (e.g. `["png", "pdf"]`). */
    allowedExtensions?: string[]
  }

  /**
   * Safe, cause-stripped error summary stored in step history and forwarded in API context.
   * The raw `cause` field is omitted because it may contain sensitive server response bodies.
   */
  export type StepError = {
    code: string
    message: string
    retryable?: boolean
  }

  /** A single recorded phase transition on an upload item. */
  export type UploadStep = {
    /** Phase name when this step was entered. */
    phase: string
    /** Epoch ms when this phase was entered. */
    enteredAt: number
    /** Epoch ms when this phase was left. Undefined while still in this phase. */
    leftAt?: number
    /** Attempt number at the time of entering this phase. */
    attempt: number
    /** Safe error summary if this phase ended in failure. Cause is stripped. */
    error?: StepError | undefined
  }

  export namespace Api {
    /** Context passed to every backend API method alongside the call-specific args. */
    export type Context<P extends string = string, M extends Intent.Map = Intent.Map> = {
      /** Client-side identifier for this file item. */
      localId: string
      /** Upload purpose. */
      purpose: P
      /** File identity: name, size, MIME type, checksum. Always present. */
      fingerprint: FingerprintFile
      /** Which attempt this is, starting at 1. Increments on retry. */
      attempt: number
      /** Epoch ms when this item was registered. */
      createdAt: number
      /** Phase history up to this call. Errors have cause stripped. */
      steps: readonly UploadStep[]
      /** Caller-supplied metadata from the addFiles command. Never persisted. */
      meta: Record<string, unknown>
      /** Safe error from the most recent failed step, if any. */
      lastError?: StepError | undefined
      /** Browser File object. Present in most phases; absent when file is not loaded. */
      file?: File | undefined
      /** Upload intent from the backend. Present after createIntent succeeds. */
      intent?: Intent.Any<M> | undefined
      /** Cancellation signal. */
      signal?: AbortSignal | undefined
    }

    /** Context for API calls where intent is not yet created but file is loaded (e.g. createIntent) */
    export type CreateIntentContext<P extends string, M extends Intent.Map> = Context<P, M> &
      Required<Pick<Context<P, M>, 'file' | 'signal'>>

    /** Context for API calls verifying file checksum (e.g. findByChecksum) */
    export type FindByChecksumContext<P extends string, M extends Intent.Map> = Context<P, M> &
      Required<Pick<Context<P, M>, 'file'>>

    /** Context for API calls executing during/after upload where intent is active (e.g. complete, signPart, completeMultipart) */
    export type CompleteContext<P extends string, M extends Intent.Map> = Context<P, M> &
      Required<Pick<Context<P, M>, 'file' | 'intent' | 'signal'>>

    /** Context for API abort calls where intent is active but file/signal might be absent (e.g. abort) */
    export type AbortContext<P extends string, M extends Intent.Map> = Context<P, M> &
      Required<Pick<Context<P, M>, 'intent'>>

    /** Contract definition for your backend API endpoints. */
    export type Me<M extends Intent.Map, P extends string, R extends Result.Base = Result.Base> = {
      /** Requests an upload intent from the server. */
      createIntent(
        args: {
          purpose: P
          contentType: string
          size: number
          filename: string
          checksum?: string
          attempt: number
        },
        ctx: CreateIntentContext<P, M>,
        ...extra: any[]
      ): Promise<M[keyof M]>

      /** Finalizes the upload on the server after bytes have been transferred. */
      complete(
        args: {
          fileId: string
          /** Sanitized filename. Do not use the raw File.name from the browser. */
          filename: string
          contentType: string
          size: number
          checksum?: string
          attempt: number
        },
        ctx: CompleteContext<P, M>,
        ...extra: any[]
      ): Promise<R>

      /** Optional endpoint to fetch a signed preview/access URL for completed resources. */
      getSignedPreviewUrl?(
        args: { fileId: string; key: string; purpose: P },
        ctx: Context<P, M>,
        ...extra: any[]
      ): Promise<string>

      /** Optional endpoint to verify if the file has already been uploaded previously. */
      findByChecksum?(
        args: { checksum: string; purpose: P },
        ctx: FindByChecksumContext<P, M>,
        ...extra: any[]
      ): Promise<R | null>

      /** Multipart-specific backend commands. Required if using the multipart strategy. */
      multipart?: {
        signPart(
          args: {
            fileId: string
            uploadId: string
            partNumber: number
            checksum?: string
            attempt: number
          },
          ctx: CompleteContext<P, M>,
          ...extra: any[]
        ): Promise<{
          url: string
          headers?: Record<string, string>
        }>

        completeMultipart(
          args: {
            fileId: string
            uploadId: string
            parts: Array<{ partNumber: number; etag: string }>
          },
          ctx: CompleteContext<P, M>,
          ...extra: any[]
        ): Promise<unknown>

        listParts?(
          args: { fileId: string; uploadId: string },
          ctx: CompleteContext<P, M>,
          ...extra: any[]
        ): Promise<Array<{ partNumber: number; etag?: string; size?: number }>>

        abort?(args: { fileId: string; uploadId: string }, ctx: AbortContext<P, M>, ...extra: any[]): Promise<void>
      }

      /** TUS resumable protocol operations. */
      tus?: {
        create(
          args: { fileId: string; size: number; filename: string; contentType: string; attempt: number },
          ctx: CompleteContext<P, M>,
          ...extra: any[]
        ): Promise<{ uploadUrl: string }>

        getOffset(args: { uploadUrl: string }, ctx: CompleteContext<P, M>, ...extra: any[]): Promise<{ offset: number }>
      }
    }
  }

  export namespace Strategy {
    /** Per-call context handed to a strategy's `start()` method. */
    export type Ctx<
      M extends Intent.Map,
      C extends Cursor.Map<M>,
      P extends string,
      R extends Result.Base,
      K extends keyof M & string,
    > = {
      localId: string
      purpose: P
      file: File
      fingerprint: FingerprintFile
      intent: M[K]
      signal: AbortSignal
      attempt: number
      createdAt: number
      steps: readonly UploadStep[]
      lastError?: StepError | undefined
      meta: Record<string, unknown>
      transport: {
        put(args: {
          url: string
          body: Blob
          headers?: Record<string, string>
          signal: AbortSignal
          onProgress?: (u: number, t: number) => void
        }): Promise<{ etag?: string | undefined; headers?: Record<string, string> }>

        postForm(args: {
          url: string
          fields: Record<string, string>
          file: File | Blob
          filename?: string
          signal: AbortSignal
          onProgress?: (uploadedBytes: number, totalBytes: number) => void
        }): Promise<{ etag?: string; headers?: Record<string, string> }>

        patch(args: {
          url: string
          body: Blob | ArrayBuffer
          headers?: Record<string, string>
          signal: AbortSignal
          onProgress?: (u: number, t: number) => void
        }): Promise<{ headers?: Record<string, string> }>
      }
      api: Api.Me<M, P, R>
      reportProgress: (p: { uploadedBytes: number; totalBytes: number }) => void
      readCursor: () => C[K] | undefined
      persistCursor: (cursor: C[K] | undefined) => void
    }

    /** A single upload strategy implementation. */
    export type Me<
      M extends Intent.Map,
      C extends Cursor.Map<M>,
      P extends string,
      R extends Result.Base,
      K extends keyof M & string,
    > = {
      id: K
      resumable: boolean
      start(ctx: Ctx<M, C, P, R, K>): Promise<void>
    }

    /** Registry of available upload strategies, keyed by strategy id. */
    export type Registry<
      M extends Intent.Map,
      C extends Cursor.Map<M>,
      P extends string = string,
      R extends Result.Base = Result.Base,
    > = {
      get<K extends keyof M & string>(id: K): Me<M, C, P, R, K> | undefined
      has(id: string): id is keyof M & string
      set<K extends keyof M & string>(strategy: Me<M, C, P, R, K>): void
    }
  }
}
