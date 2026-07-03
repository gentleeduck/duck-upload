import type React from 'react'
import type { Contracts, Engine } from '../core'
import type { Store } from '../core/engine/store'

/**
 * Public typings and namespaces consumed by React hook components.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace Uploader {
  /**
   * Return state payload returned by the `useUploader` hook.
   *
   * @template M - Intent map type
   * @template C - Cursor map type
   * @template P - Purpose string union type
   * @template R - Backend result shape
   */
  export type State<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = Pick<Store.UploadStore<M, C, P, R>, 'dispatch' | 'on' | 'off'> & {
    /** List of all registered upload items currently tracked. */
    items: Array<Engine.Item<M, C, P, R>>

    /** Upload items grouped by phase. */
    byPhase: Record<Engine.Phase, Array<Engine.Item<M, C, P, R>>>

    /** Subset of items currently active in the transfer phase. */
    uploading: Array<Engine.Item<M, C, P, R>>

    /** Subset of items currently paused. */
    paused: Array<Engine.Item<M, C, P, R>>

    /** Subset of items that successfully completed uploading and backend finalization. */
    completed: Array<Engine.Item<M, C, P, R>>

    /** Subset of items currently in the error state. */
    failed: Array<Engine.Item<M, C, P, R>>

    /** Subset of items validated and waiting to begin uploading. */
    ready: Array<Engine.Item<M, C, P, R>>
  }

  /**
   * Bound action callbacks returned by context hooks.
   *
   * Houses both the bound dispatchers and the raw underlying store reference.
   *
   * @template M - Intent map type
   * @template C - Cursor map type
   * @template P - Purpose string union type
   * @template R - Backend result shape
   */
  export type IActions<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > = Pick<Store.UploadStore<M, C, P, R>, 'dispatch' | 'on'> & {
    /** The raw upload store instance. */
    store: Store.UploadStore<M, C, P, R>
  }

  /**
   * Props for the `<UploadProvider>` component.
   */
  export interface ProviderProps<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base = Contracts.Result.Base,
  > {
    /** The upload store instance to distribute. */
    store: Store.UploadStore<M, C, P, R>
    /** React child elements. */
    children: React.ReactNode
  }
}
