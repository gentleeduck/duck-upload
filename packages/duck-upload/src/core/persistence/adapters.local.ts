import { stripDangerousKeys } from '../utils/guards'
import type { UploadPersistence } from './persistence.types'

/**
 * Persistence adapter backed by `localStorage`. Synchronous and simple; best
 * suited to small snapshots.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export const LocalStorageAdapter: UploadPersistence.Adapter = {
  load(key) {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    try {
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
