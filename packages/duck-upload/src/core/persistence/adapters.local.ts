import { stripDangerousKeys } from '../utils/guards'
import type { PersistenceAdapter } from './persistence.types'

export const LocalStorageAdapter: PersistenceAdapter = {
  load(key) {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    try {
      // SEC-002: same-origin attackers can write arbitrary JSON to
      // localStorage. Strip prototype-pollution keys before the parsed shape
      // reaches any spread / property-copy in the hydrate path.
      return stripDangerousKeys(JSON.parse(raw))
    } catch {
      return null
    }
  },
  save(key, snapshot) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(snapshot))
  },
  clear(key) {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  },
}
