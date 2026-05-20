import type { PersistenceAdapter } from './persistence.types'

/**
 * Create an in-memory {@link PersistenceAdapter} backed by a fresh `Map`.
 *
 * SEC-008: each call returns an isolated store. Multi-engine and
 * multi-tenant deployments must use the factory so engine instances
 * cannot read or overwrite each other's snapshots.
 *
 * @example
 * ```ts
 * const adapter = createMemoryAdapter()
 * createUploadStore({ persistence: { adapter, key: 'tenant-a' } })
 * ```
 */
export function createMemoryAdapter(): PersistenceAdapter {
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
 * Backwards-compatible singleton — every import shares one `Map`.
 *
 * @deprecated Use {@link createMemoryAdapter} instead. The shared
 * singleton leaks snapshot state between engine instances and is
 * unsafe for multi-tenant deployments (SEC-008). Kept for callers
 * that have not yet migrated.
 */
export const MemoryAdapter: PersistenceAdapter = createMemoryAdapter()
