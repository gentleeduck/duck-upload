import { createContext, useContext, useEffect } from 'react'
import type { Contracts } from '../core'
import type { Store } from '../core/engine/store'
import type { Uploader } from './uploader.types'

const UploadContext = createContext<Store.UploadStore<any, any, any, any> | null>(null)

/**
 * Context provider that distributes the upload store across the React component hierarchy.
 *
 * Wrap this provider around the top of your layout to enable child hooks like `useUploader`
 * to access upload status.
 *
 * @example
 * ```tsx
 * const store = createUploadStore({ ... });
 *
 * function App() {
 *   return (
 *     <UploadProvider store={store}>
 *       <UploadForm />
 *     </UploadProvider>
 *   );
 * }
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function UploadProvider<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>({ store, children }: Uploader.ProviderProps<M, C, P, R>) {
  // Safe cleanup: destroy the store runner instance if the provider is unmounted.
  useEffect(() => {
    return () => {
      if ('destroy' in store && typeof store.destroy === 'function') {
        ;(store as unknown as { destroy: () => void }).destroy()
      }
    }
  }, [store])

  return <UploadContext.Provider value={store}>{children}</UploadContext.Provider>
}

/**
 * Returns the active upload store instance from context.
 * Throws a runtime exception if called outside an `<UploadProvider>`.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function useUploadStore<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(): Store.UploadStore<M, C, P, R> {
  const context = useContext(UploadContext)
  if (!context) {
    throw new Error('useUploadStore must be used within an <UploadProvider>')
  }
  return context as Store.UploadStore<M, C, P, R>
}

/**
 * Runtime type guard: returns `true` when `value` exposes the upload-store
 * surface (`getSnapshot`, `subscribe`, `dispatch`, `on`, `off`, `waitFor`).
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function isUploadStore<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(value: unknown): value is Store.UploadStore<M, C, P, R> {
  if (typeof value !== 'object' || value === null) return false
  const val = value as Record<string, unknown>
  return (
    typeof val['getSnapshot'] === 'function' &&
    typeof val['subscribe'] === 'function' &&
    typeof val['dispatch'] === 'function' &&
    typeof val['on'] === 'function' &&
    typeof val['off'] === 'function' &&
    typeof val['waitFor'] === 'function'
  )
}
