export namespace Emitter {
  /**
   * Minimal typed event emitter interface.
   *
   * Use this to expose strongly-typed events from your store.
   *
   * @typeParam E - Event map (`eventName -> payload`).
   */
  export type TypedEmitter<E extends Record<string, unknown>> = {
    /**
     * Subscribe to an event.
     * @returns Unsubscribe function.
     */
    on<K extends keyof E & string>(type: K, cb: (payload: E[K]) => void): () => void

    /**
     * Unsubscribe from an event.
     */
    off<K extends keyof E & string>(type: K, cb: (payload: E[K]) => void): void

    /** Emit an event to all listeners. */
    emit<K extends keyof E & string>(type: K, payload: E[K]): void
  }

  /**
   * Callback invoked when a listener throws during `emit`, so one bad listener
   * cannot break the dispatch loop. Receives the event type, the thrown error,
   * and the listener that threw.
   */
  export type ErrorHandler = (type: string, error: unknown, cb: (...args: any[]) => void) => void

  /**
   * Listener registry, bucketed by event type.
   *
   * @template E Event map.
   */
  export type ListenerMap<E extends Record<string, unknown>> = Partial<{
    [K in keyof E & string]: Set<(payload: E[K]) => void>
  }>
}
