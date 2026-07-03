import type { UploadPersistence } from './persistence.types'

/**
 * Create an in-memory {@link PersistenceAdapter} backed by a fresh `Map`.
 *
 * Each call returns an isolated store. Multi-engine and multi-tenant
 * deployments must use the factory so engine instances cannot read or
 * overwrite each other's snapshots.
 *
 * @example
 * ```ts
 * const adapter = createMemoryAdapter()
 * createUploadStore({ persistence: { adapter, key: 'tenant-a' } })
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function createMemoryAdapter(): UploadPersistence.Adapter {
  const store = new Map<string, unknown>()
  return {
    load(key) {
      return store.get(key) ?? null
    },
    save(key, snapshot) {
      store.set(key, snapshot)
    },
    clear(key) {
      store.delete(key)
    },
  }
}

/**
 * Shared in-memory adapter instance. Convenient for single-engine apps; use
 * {@link createMemoryAdapter} when isolation between engines is required.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export const MemoryAdapter = createMemoryAdapter()
