/**
 * Strategy registry helpers.
 *
 * Core strategy types live in `core/contracts/strategy.types.ts`.
 */

import type { Contracts } from '../../core/contracts'

/**
 * Create an empty strategy registry. Register upload strategies with `set`, then
 * resolve them by id with `get` / `has`.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function createStrategyRegistry<
  M extends Contracts.Intent.Map,
  C extends Contracts.Cursor.Map<M>,
  P extends string,
  R extends Contracts.Result.Base = Contracts.Result.Base,
>(): Contracts.Strategy.Registry<M, C, P, R> {
  const map: Partial<{ [K in keyof M & string]: Contracts.Strategy.Me<M, C, P, R, K> }> = {}

  return {
    get(id) {
      return map[id]
    },
    has(id): id is keyof M & string {
      return Object.hasOwn(map, id)
    },
    set(strategy) {
      map[strategy.id] = strategy
    },
  }
}
