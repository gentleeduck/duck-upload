import type { Contracts } from '../contracts/contracts.types'
import type { UploadError } from '../errors'
import type { Store } from './store'

/**
 * Engine-level type surface containing runtime state models, commands, progress,
 * and configuration options.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace Engine {
  /**
   * Return value from a retry policy determining if and when a task should be re-scheduled.
   */
  export type RetryDecision =
    | {
        /** The task has failed terminal or cannot recover. */
        retryable: false
      }
    | {
        /** The task is recoverable and should retry. */
        retryable: true
        /** Delay duration in milliseconds before invoking the next attempt. */
        delayMs: number
      }

  /**
   * Global upload engine configuration.
   *
   * Coordinates concurrency limits, retry strategies, constraints, and validation.
   *
   * @typeParam P - Union of allowed `purpose` strings for your app (e.g. `"avatar" | "attachment"`).
   */
  export type Config<P extends string> = {
    /**
     * Maximum number of parallel uploads active at any time.
     * Queued items wait until active uploads complete or fail.
     */
    maxConcurrentUploads: number

    /**
     * Auto-start uploads for specific purposes.
     * - Array form: only files with these purposes automatically begin uploading on registration.
     * - Function form: dynamic callback determining whether to auto-start.
     */
    autoStart?: (readonly P[] | ((purpose: P) => boolean)) | undefined

    /**
     * Throttle delay in milliseconds for progress events.
     * Limits rendering updates and state changes under busy progress flows.
     */
    progressThrottleMs: number

    /**
     * Validation rules keyed by purpose.
     */
    validation: Partial<Record<P, Contracts.ValidationRules>>

    /**
     * Maximum number of retry attempts permitted for upload/intent actions.
     */
    maxAttempts: number

    /**
     * Custom retry policy handler.
     * Overrides default exponential backoff calculation.
     */
    retryPolicy?:
      | ((ctx: {
          /** The active execution phase. */
          phase: 'intent' | 'upload' | 'complete'
          /** Current attempt number (starting at 1). */
          attempt: number
          /** The normalized error structure. */
          error: UploadError
        }) => RetryDecision)
      | undefined

    /**
     * Maximum number of items to keep in memory/state.
     * When exceeded, oldest completed/canceled items are evicted automatically.
     *
     * Set to `undefined` for no limit (not recommended for long-running single-page apps).
     */
    maxItems: number

    /**
     * Duration in milliseconds after which completed items are evicted from the store.
     * Set to `undefined` to preserve completed items indefinitely.
     */
    completedItemTTL?: number | undefined

    /**
     * Set to `true` to validate files by sniffing magic bytes/mime signature
     * and rejecting files whose suffix does not match structural magic numbers.
     */
    strictMimeMatch?: boolean | undefined

    /**
     * Limit on file size in bytes up to which checksum calculations are run.
     * Large files skip client-side checksum hash calculations to prevent freezing UI threads.
     * Set to `null` or `undefined` for no limit.
     */
    checksumMaxSize?: number | null | undefined
  }

  /**
   * Upload progress snapshot.
   */
  export type Progress = {
    /** Bytes uploaded so far. */
    uploadedBytes: number
    /** Total bytes to upload. */
    totalBytes: number
    /** Percent complete (0..100). */
    pct: number
  }

  /**
   * Describes how a `completed` upload item resolved.
   * - `'upload'`: standard byte transfer.
   * - `'dedupe'`: server matched existing file checksum, skipping byte transfer.
   */
  export type CompletionKind = 'upload' | 'dedupe'

  /**
   * Terminal outcome returned by `waitFor`.
   *
   * @template R Result type carried on successful completion.
   */
  export type Outcome<R extends Contracts.Result.Base> =
    | {
        localId: string
        status: 'completed'
        completedBy: CompletionKind
        result: R
      }
    | {
        localId: string
        status: 'error'
        error: UploadError
      }
    | {
        localId: string
        status: 'canceled'
      }
    | {
        localId: string
        status: 'missing'
        /**
         * Why the id is missing.
         * - `'removed'`: explicit user removal.
         * - `'evicted'`: automatically removed (maxItems/TTL rules).
         * - `'never-existed'`: id was never registered.
         * - `'destroyed'`: store was destroyed.
         */
        reason: 'removed' | 'evicted' | 'never-existed' | 'destroyed'
      }

  /**
   * Public commands dispatched to the upload store.
   *
   * @template P Purpose discriminator string.
   */
  export type Command<P extends string> =
    | {
        /** Register files into the upload store for a specific purpose. */
        type: 'addFiles'
        files: File[]
        purpose: P
        /** Optional caller metadata forwarded to every backend API call for this file. */
        meta?: Record<string, unknown> | undefined
      }
    | {
        /** Start uploading a specific file. */
        type: 'start'
        localId: string
      }
    | {
        /** Start all queued files, optionally filtering by purpose. */
        type: 'startAll'
        purpose?: P
      }
    | {
        /** Pause an active upload. */
        type: 'pause'
        localId: string
      }
    | {
        /** Pause all active uploads, optionally filtering by purpose. */
        type: 'pauseAll'
        purpose?: P
      }
    | {
        /** Resume a paused upload. */
        type: 'resume'
        localId: string
      }
    | {
        /** Cancel a pending or active upload. */
        type: 'cancel'
        localId: string
      }
    | {
        /** Cancel all pending and active uploads, optionally filtering by purpose. */
        type: 'cancelAll'
        purpose?: P
      }
    | {
        /** Retry a failed upload item. */
        type: 'retry'
        localId: string
      }
    | {
        /** Re-bind a new browser `File` object to a resumed/paused item missing a file reference. */
        type: 'rebind'
        localId: string
        file: File
      }
    | {
        /** Remove an item from the store state entirely. */
        type: 'remove'
        localId: string
      }

  /**
   * Const mapping of upload stages.
   */
  export const Phases = {
    /** Initial validation checks are running. */
    validating: 'validating',
    /** Fetching signed URLs and strategies from backend. */
    creating_intent: 'creating_intent',
    /** Ready to start uploading bytes. */
    ready: 'ready',
    /** Waiting in queue (concurrency cap reached). */
    queued: 'queued',
    /** Actively transferring bytes. */
    uploading: 'uploading',
    /** Upload paused; resumable state preserved. */
    paused: 'paused',
    /** Triggering backend finalization. */
    completing: 'completing',
    /** File is fully completed and registered on backend. */
    completed: 'completed',
    /** Execution hit a terminal error or maximum retry cap. */
    error: 'error',
    /** Upload was canceled by the user. */
    canceled: 'canceled',
  } as const

  /** Every upload phase; the `phase` discriminator of {@link Item}. */
  export type Phase = keyof typeof Phases

  interface BaseItem<P extends string> {
    /** Unique client-side identifier for this file item. */
    localId: string
    /** Target upload purpose. */
    purpose: P
    /** Metadata properties identifying the file. */
    fingerprint: Contracts.FingerprintFile
    /** Epoch timestamp in ms when the item was registered. */
    createdAt: number
    attempt?: number | undefined
    file?: File | undefined
    /** Full phase history. Each entry records when a phase was entered/left and any stripped error. */
    steps: Contracts.UploadStep[]
    /** Arbitrary caller-supplied metadata from the addFiles command. Never persisted. */
    meta: Record<string, unknown>
  }

  /**
   * Representational union of upload items in their respective lifecycle phases.
   */
  export type Item<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = BaseItem<P> &
    (
      | { phase: 'validating'; file: File }
      | { phase: 'creating_intent'; file: File; attempt: number }
      | {
          phase: 'ready'
          file: File
          intent: Contracts.Intent.Any<M>
          cursor?: Contracts.Cursor.Any<C> | undefined
          progress?: Progress | undefined
        }
      | {
          phase: 'queued'
          file: File
          intent: Contracts.Intent.Any<M>
          requestedAt: number
          cursor?: Contracts.Cursor.Any<C> | undefined
          progress?: Progress | undefined
        }
      | {
          phase: 'uploading'
          file: File
          intent: Contracts.Intent.Any<M>
          startedAt: number
          progress: Progress
          cursor?: Contracts.Cursor.Any<C> | undefined
        }
      | {
          phase: 'paused'
          intent: Contracts.Intent.Any<M>
          cursor: Contracts.Cursor.Any<C>
          progress: Progress
          pausedAt: number
          file?: File | undefined
        }
      | { phase: 'completing'; file: File; intent: Contracts.Intent.Any<M>; progress: Progress; completingAt: number }
      | {
          phase: 'completed'
          completedBy: CompletionKind
          result: R
          completedAt: number
          intent?: Contracts.Intent.Any<M> | undefined
          file?: File | undefined
        }
      | {
          phase: 'error'
          error: UploadError
          retryable: boolean
          attempt: number
          failedAt: number
          file?: File | undefined
          intent?: Contracts.Intent.Any<M> | undefined
          cursor?: Contracts.Cursor.Any<C> | undefined
          progress?: Progress | undefined
        }
      | {
          phase: 'canceled'
          canceledAt: number
          file?: File | undefined
          intent?: Contracts.Intent.Any<M> | undefined
          cursor?: Contracts.Cursor.Any<C> | undefined
          progress?: Progress | undefined
          attempt?: number | undefined
        }
    )

  /**
   * Immutable state shape of the upload engine store.
   */
  export type State<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /** Map of active and historical upload items. */
    items: Map<string, Item<M, C, P, R>>
  }

  /**
   * Interface for registering lifecycle plugins.
   */
  export type Plugin<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /** Name of the plugin (for diagnostics). */
    name: string
    /** Sets up subscription listener binds on the store core proxy. */
    setup(store: Pick<Store.UploadStore<M, C, P, R>, 'on' | 'off' | 'dispatch' | 'getSnapshot'>): void
  }

  /**
   * Events emitted by effects and consumed by the reducer to transition item states.
   */
  export type Event<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > =
    | {
        type: 'files.added'
        items: Array<{
          localId: string
          purpose: P
          file: File
          fingerprint: Contracts.FingerprintFile
          createdAt: number
          meta: Record<string, unknown>
        }>
      }
    | { type: 'fingerprint.updated'; localId: string; fingerprint: Contracts.FingerprintFile }
    | { type: 'validation.ok'; localId: string }
    | { type: 'validation.failed'; localId: string; reason: Contracts.Validation.Rejection }
    | { type: 'intent.ok'; localId: string; intent: Contracts.Intent.Any<M> }
    | { type: 'intent.failed'; localId: string; error: UploadError; retryable: boolean }
    | { type: 'upload.begin'; localId: string; startedAt: number }
    | { type: 'upload.progress'; localId: string; uploadedBytes: number; totalBytes: number }
    | { type: 'cursor.updated'; localId: string; cursor: Contracts.Cursor.Any<C> }
    | { type: 'upload.ok'; localId: string }
    | { type: 'upload.failed'; localId: string; error: UploadError; retryable: boolean }
    | { type: 'dedupe.ok'; localId: string; result: R }
    | { type: 'complete.ok'; localId: string; result: R }
    | { type: 'complete.failed'; localId: string; error: UploadError; retryable: boolean }
    | { type: 'paused'; localId: string; cursor: Contracts.Cursor.Any<C>; pausedAt: number }
    | { type: 'canceled'; localId: string; canceledAt: number }

  /**
   * Public event registry mapping event names to payloads emitted via `store.on()`.
   */
  export type EventMap<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /** Emitted when a file is validated and successfully registered in state. */
    'file.added': { localId: string; purpose: P; file: File; fingerprint: Contracts.FingerprintFile }
    /** Emitted when a file fails client-side validation rules. */
    'file.rejected': { file: File; reason: Contracts.Validation.Rejection }

    /** Emitted when validation succeeds. */
    'validation.ok': { localId: string }
    /** Emitted when validation fails. */
    'validation.failed': { localId: string; reason: Contracts.Validation.Rejection }

    /** Emitted when intent lookup/creation is requested. */
    'intent.creating': { localId: string }
    /** Emitted when upload intent is successfully created. */
    'intent.created': { localId: string; intent: M[keyof M] }
    /** Emitted when intent creation fails. */
    'intent.failed': { localId: string; error: UploadError; retryable: boolean }

    /** Emitted when an item is queued waiting for concurrency slots. */
    'upload.queued': { localId: string }
    /** Emitted when a paused upload is resumed. */
    'upload.resumed': { localId: string }
    /** Emitted when data transfer starts. */
    'upload.started': { localId: string }
    /** Periodic progress event. */
    'upload.progress': { localId: string; pct: number; uploadedBytes: number; totalBytes: number }
    /** Emitted when strategy cursor state is updated. */
    'upload.cursor': { localId: string; cursor: Contracts.Cursor.Any<C> }
    /** Emitted when upload is paused. */
    'upload.paused': { localId: string; cursor: Contracts.Cursor.Any<C> }
    /** Emitted when upload is canceled. */
    'upload.canceled': { localId: string }

    /** Emitted when final completing steps (like completeMultipart or final verification) begin. */
    'upload.completing': { localId: string }
    /** Emitted when a file is completely uploaded and finalized. */
    'upload.completed': { localId: string; result: R; completedBy: CompletionKind }

    /** Emitted when transfer hits a retryable or terminal error. */
    'upload.error': { localId: string; error: UploadError; retryable: boolean }

    /** Emitted when an item is removed from the store state. */
    'upload.removed': { localId: string; reason: 'user' | 'cleanup' }

    /** Emitted when a file rebind operation succeeds. */
    'rebind.ok': { localId: string }
    /** Emitted when a file rebind fails. */
    'rebind.failed': { localId: string; reason: RebindReason }
  }

  /**
   * Rebind failure classifications.
   */
  export type RebindReason =
    | { code: 'no_item' }
    | { code: 'wrong_phase'; phase: string }
    | { code: 'already_bound' }
    | { code: 'fingerprint_mismatch'; expected: Contracts.FingerprintFile; got: Contracts.FingerprintFile }

  /**
   * Diagnostic hooks for observing engine updates.
   */
  export type Hooks<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /** Callback invoked on every state-reducing internal event. */
    onInternalEvent?: (event: Event<M, C, P, R>, state: State<M, C, P, R>) => void
  }
}
