import type { Contracts, Transport } from '../../contracts'
import type { UploadPersistence } from '../../persistence'
import type { Emitter } from '../../utils'
import type { Engine } from '../engine.types'
import type { createReducer } from '../reducer'

/**
 * Store-level namespaces and contracts.
 */
export namespace Store {
  /**
   * Public upload store interface used by UI adapters and application code.
   *
   * Coordinates commands, subscriptions, event bindings, and lifecycle states.
   *
   * @template M - Intent map type (keyed by strategy id)
   * @template C - Cursor map type (keyed by strategy id)
   * @template P - Purpose string union type
   * @template R - Backend result shape
   */
  export type UploadStore<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /**
     * Returns the current immutable state snapshot.
     * Use this in custom React lifecycle bindings or debug inspectors.
     */
    getSnapshot(): Engine.State<M, C, P, R>

    /**
     * Subscribes to any internal state change.
     * Triggered after reducers process events and side effects are queued.
     *
     * @param listener - Callback invoked on state updates.
     * @returns An unsubscribe function.
     */
    subscribe(listener: () => void): () => void

    /**
     * Dispatches a command to initiate state transitions (e.g. adding files, pausing, canceling).
     *
     * @param cmd - Public command payload.
     */
    dispatch(cmd: Engine.Command<P>): void

    /**
     * Binds a listener to a specific typed event (e.g. `'upload.progress'`).
     *
     * @param type - Event name key.
     * @param cb - Event listener callback.
     * @returns An unsubscribe function.
     */
    on: <K extends keyof Engine.EventMap<M, C, P, R> & string>(
      type: K,
      cb: (payload: Engine.EventMap<M, C, P, R>[K]) => void,
    ) => () => void

    /**
     * Removes an event listener.
     *
     * @param type - Event name key.
     * @param cb - Event listener callback.
     */
    off: <K extends keyof Engine.EventMap<M, C, P, R> & string>(
      type: K,
      cb: (payload: Engine.EventMap<M, C, P, R>[K]) => void,
    ) => void

    /**
     * Resolves when the specified items reach a terminal state
     * (completed, failed, canceled, or missing).
     *
     * @param localIds - Array of registered client file IDs.
     */
    waitFor(localIds: string[]): Promise<Array<Engine.Outcome<R>>>
  }

  /**
   * Configuration options for constructing an upload store.
   *
   * @template M - Intent map type (keyed by strategy id)
   * @template C - Cursor map type (keyed by strategy id)
   * @template P - Purpose string union type
   * @template R - Backend result shape
   */
  export type Options<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /** Initial state to hydrate from (e.g. recovered from a persistence snapshot). */
    initialState?: Engine.State<M, C, P, R>

    /** Engine configuration (defaults applied for unspecified settings). */
    config?: Partial<Engine.Config<P>>

    /** Persistence adapter configuration (key prefix, adapters, storage handlers). */
    persistence?: UploadPersistence.Options<M, C, P, R>

    /** Your backend API implementation. */
    api: Contracts.Api.Me<M, P, R>

    /** Transport layer options for HTTP byte transfers. */
    transport?: Transport.Options

    /** Registry of available upload strategies (multipart, POST forms, simple PUTs, TUS). */
    strategies: Contracts.Strategy.Registry<M, C, P, R>

    /** Plugin modules to extend behavior (metrics, logging, analytics). */
    plugins?: Array<Engine.Plugin<M, C, P, R>>

    /** Lifecycle hooks for observing internal events. */
    hooks?: Engine.Hooks<M, C, P, R>

    /**
     * Override to use a custom fingerprinting implementation (e.g. a custom hash).
     */
    fingerprint?: (file: File) => Contracts.FingerprintFile

    /**
     * Custom per-file validator called after built-in config constraints pass.
     * Return a rejection to block the file; return null to allow it.
     */
    validateFile?: (file: File, purpose: P) => Contracts.Validation.Rejection | null

    /**
     * Custom error normalizer.
     * Converts raw thrown values into a standardized Contracts.Errors.Error.
     */
    errorNormalizer?: (err: unknown) => Contracts.Errors.Error
  }

  /**
   * Tracks an in-flight upload operation.
   */
  export type InflightUpload = {
    /** AbortController for this upload. */
    controller: AbortController
    /** Whether the upload is running normally, being paused, or being canceled. */
    mode: 'normal' | 'pause' | 'cancel'
    /** True once the strategy's start() has been called. */
    started: boolean
  }

  /**
   * Internal execution context shared across store utilities, handlers, and schedulers.
   */
  export type Runtime<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = {
    /** Resolved store options with all defaults applied. */
    opts: Options<M, C, P, R> & { config: Engine.Config<P>; transport: Transport.Options }
    /** Current engine state. */
    state: Engine.State<M, C, P, R>

    /** Active state change subscribers. */
    listeners: Set<() => void>
    /** Typed event emitter. */
    emitter: Emitter.TypedEmitter<Engine.EventMap<M, C, P, R>>
    /** Reducer function. */
    reduce: ReturnType<typeof createReducer<M, C, P, R>>

    /** Inflight upload operations keyed by localId. */
    inflightUploads: Map<string, InflightUpload>
    /** Inflight intent creation requests keyed by localId. */
    inflightIntents: Map<string, AbortController>
    /** Inflight complete() calls keyed by localId. */
    inflightCompletes: Map<string, AbortController>

    /** Queued async side effects. */
    effectQueue: Array<() => Promise<void>>
    /** True while the effect queue is being drained. */
    processingEffects: boolean
    /** True while scheduleWork is running, preventing re-entrant calls. */
    scheduling: boolean

    /** Notifies all state change subscribers. */
    notify: () => void
    /** Starts queued uploads when concurrency slots are available. */
    scheduleWork: () => void
    /** Applies an internal event through the reducer and notifies subscribers. */
    applyInternal: (event: Engine.Event<M, C, P, R>) => void
    /** Runs a command through the reducer. */
    applyCommand: (cmd: Engine.Command<P>) => void
    /** Adds an async side effect to the execution queue. */
    enqueueEffect: (effect: () => Promise<void>) => void
    /** Drains the effect queue, running each side effect in order. */
    processEffects: () => Promise<void>
    /** Dispatches a public command. */
    dispatch: (cmd: Engine.Command<P>) => void
  }
}
