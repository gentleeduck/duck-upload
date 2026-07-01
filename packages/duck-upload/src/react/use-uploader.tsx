import * as React from 'react'
import { useMemo, useSyncExternalStore } from 'react'
import type { Contracts, Engine } from '../core'
import type { Store } from '../core/engine/store'
import { useUploadStore } from './upload-provider'
import type { Uploader } from './uploader.types'

/**
 * Hook to consume the upload store state, track files, and interact with the upload engine.
 *
 * Exposes files, categorizes items by status phase (ready, uploading, paused, completed, failed),
 * and registers action dispatchers.
 *
 * Can optionally be passed a specific store instance directly. Otherwise, it will read the store from context.
 *
 * @example
 * ```tsx
 * function UploadForm() {
 *   const { items, uploading, dispatch } = useUploader();
 *
 *   const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 *     if (e.target.files) {
 *       dispatch({ type: 'addFiles', files: Array.from(e.target.files), purpose: 'avatar' });
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={onFileChange} multiple />
 *       <ul>
 *         {items.map(item => (
 *           <li key={item.localId}>{item.fingerprint.name} - {item.phase}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 *
 * @template M - Intent map type
 * @template C - Cursor map type
 * @template P - Purpose string union type
 * @template R - Backend result shape
 */
export function useUploader<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(providedStore?: Store.UploadStore<M, C, P, R> | undefined): Uploader.State<M, C, P, R> {
  const contextStore = useUploadStore<M, C, P, R>()
  const store = providedStore ?? contextStore

  if (!store) {
    throw new Error('useUploader must be used within an <UploadProvider> or passed a store instance directly.')
  }

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot, // SSR fallback placeholder.
  )

  const items = useMemo(() => {
    return Array.from(state.items.values())
  }, [state])

  const byPhase = useMemo(() => {
    const result: Record<Engine.Phase, Array<Engine.Item<M, C, P, R>>> = {
      validating: [],
      creating_intent: [],
      ready: [],
      queued: [],
      uploading: [],
      paused: [],
      completing: [],
      completed: [],
      error: [],
      canceled: [],
    }
    items.forEach((item) => {
      const phase = item.phase
      if (!result[phase]) {
        result[phase] = []
      }
      result[phase].push(item)
    })
    return result
  }, [items])

  return {
    items,
    byPhase,
    dispatch: store.dispatch.bind(store),
    on: store.on.bind(store),
    off: store.off.bind(store),
    uploading: byPhase.uploading || [],
    paused: byPhase.paused || [],
    completed: byPhase.completed || [],
    failed: byPhase.error || [],
    ready: byPhase.ready || [],
  }
}

/**
 * Returns the store's imperative actions (dispatch, event bindings) along with a direct
 * reference to the store instance. Does not trigger React re-renders on upload progress or state changes.
 *
 * Use this when you only need to trigger commands or subscribe to events without binding UI lists.
 */
export function useUploaderActions<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(): Uploader.IActions<M, C, P, R> {
  const store = useUploadStore<M, C, P, R>()

  const dispatch = React.useMemo(() => store.dispatch.bind(store), [store])
  const on = React.useMemo(() => store.on.bind(store), [store])

  return { dispatch, on, store }
}

/**
 * Creates a bound `useUploader` hook pre-configured for a specific store instance.
 *
 * Useful for building static multi-uploader widgets or context-free setups.
 */
export function createUploadFactory<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(store: Store.UploadStore<M, C, P, R>) {
  return () => useUploader<M, C, P, R>(store)
}
