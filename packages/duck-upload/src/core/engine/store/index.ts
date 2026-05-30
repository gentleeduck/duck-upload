import type { CursorMap, IntentMap, UploadResultBase } from '../../contracts'
import type { UploadOutcome } from '../outcome.types'
import { dispatch as internalDispatch } from './store.dispatch'
import { createStoreRuntime } from './store.runtime'
import type { StoreOptions, StoreRuntime, UploadStore } from './store.types'

/**
 * The runtime object: dispatch commands, subscribe to state changes,
 * subscribe to typed events. Plugins are initialized once during
 * construction with a minimal proxy (events / dispatch / snapshot) so
 * they cannot reach into store internals.
 */
export function createUploadStore<
  M extends IntentMap,
  C extends CursorMap<M>,
  P extends string,
  R extends UploadResultBase = UploadResultBase,
>(opts: StoreOptions<M, C, P, R>): UploadStore<M, C, P, R> {
  const rt = createStoreRuntime(opts)

  // Wire dispatch for handlers that need retries without import cycles.
  rt.dispatch = (cmd) => internalDispatch(rt, cmd)

  const storeProxy: Pick<UploadStore<M, C, P, R>, 'on' | 'off' | 'dispatch' | 'getSnapshot'> = {
    on: rt.emitter.on.bind(rt.emitter),
    off: rt.emitter.off.bind(rt.emitter),
    dispatch: rt.dispatch,
    getSnapshot: () => rt.state,
  }

  // Plugin setup
  for (const plugin of opts.plugins || []) {
    try {
      plugin.setup(storeProxy)
    } catch (err) {
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        console.error(`[UploadEngine] Plugin "${plugin.name}" failed to setup:`, err)
      }
    }
  }

  return {
    ...storeProxy,
    subscribe: (listener) => {
      rt.listeners.add(listener)
      return () => rt.listeners.delete(listener)
    },
    waitFor(localIds) {
      return waitForOutcomes(rt, localIds)
    },
  }
}

export * from './store.types'

function waitForOutcomes<M extends IntentMap, C extends CursorMap<M>, P extends string, R extends UploadResultBase>(
  rt: StoreRuntime<M, C, P, R>,
  localIds: string[],
): Promise<Array<UploadOutcome<R>>> {
  if (localIds.length === 0) return Promise.resolve([])

  const pending = new Set(localIds)
  const outcomes = new Map<string, UploadOutcome<R>>()

  const update = () => {
    for (const id of pending) {
      const item = rt.state.items.get(id)
      if (!item) {
        outcomes.set(id, { localId: id, status: 'missing' })
        pending.delete(id)
        continue
      }

      if (item.phase === 'completed') {
        outcomes.set(id, { localId: id, status: 'completed', completedBy: item.completedBy, result: item.result })
        pending.delete(id)
        continue
      }

      if (item.phase === 'error') {
        outcomes.set(id, { localId: id, status: 'error', error: item.error })
        pending.delete(id)
        continue
      }

      if (item.phase === 'canceled') {
        outcomes.set(id, { localId: id, status: 'canceled' })
        pending.delete(id)
      }
    }
  }

  update()

  if (pending.size === 0) {
    return Promise.resolve(localIds.map((id) => outcomes.get(id) ?? { localId: id, status: 'missing' }))
  }

  return new Promise((resolve) => {
    const listener = () => {
      update()
      if (pending.size === 0) {
        rt.listeners.delete(listener)
        resolve(localIds.map((id) => outcomes.get(id) ?? { localId: id, status: 'missing' }))
      }
    }
    rt.listeners.add(listener)
  })
}
