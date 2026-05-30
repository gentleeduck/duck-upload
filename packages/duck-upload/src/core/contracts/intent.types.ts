/**
 * Base shape for all upload intents (backend-supplied data describing how the client should upload).
 *
 * @typeParam K - Strategy key / discriminant string (example: `"direct" | "multipart"`).
 */
export type IntentBase<K extends string = string> = {
  /** Strategy name (discriminant). */
  strategy: K
  /** Unique backend file identifier. */
  fileId: string
}

/** Registry of intent types mapped by strategy name. `M[keyof M]` is the "any intent" union. */
export type IntentMap = Record<string, IntentBase<string>>

/** Union of strategy keys for an intent map. */
export type StrategyKey<M extends IntentMap> = keyof M & string

/** Union of all intent variants for an intent map. */
export type AnyIntent<M extends IntentMap> = M[StrategyKey<M>]
