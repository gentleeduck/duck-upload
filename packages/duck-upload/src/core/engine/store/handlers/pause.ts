import type { Contracts } from '../../../contracts'
import type { Store } from '../store.types'

export function handlePause<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base,
>(rt: Store.Runtime<M, C, P, R>, localId: string) {
  const inflight = rt.inflightUploads.get(localId)
  if (inflight) {
    inflight.mode = 'pause'
    inflight.controller.abort({ reason: 'pause' })
    return
  }

  // If not inflight but queued, reducer already reverts it to ready.
}
