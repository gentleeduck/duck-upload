import type { Contracts } from '../contracts'
import type { Engine } from '../engine/engine.types'

/**
 * Persistence layer interfaces and options.
 * @author wildduck2 <https://github.com/wildduck2>
 */
export namespace UploadPersistence {
  /**
   * Type context handed to deserializers to validate dynamic properties during recovery.
   *
   * @template M - Intent map type
   * @template P - Purpose string union type
   */
  export type DeserializeContext<M extends Contracts.Intent.Map, P extends string> = {
    /** Guard checking if a purpose string is valid. */
    isPurpose?: ((value: string) => value is P) | undefined
    /** Guard checking if an intent matches expected schemas. */
    isIntent?: ((value: unknown) => value is M[keyof M]) | undefined
    /** Query to verify if a strategy discriminant is active in runtime strategies. */
    hasStrategy?: ((value: string) => boolean) | undefined
  }

  /**
   * Configuration options for the upload store persistence manager.
   *
   * @template M - Intent map type
   * @template C - Cursor map type
   * @template P - Purpose string union type
   * @template R - Backend result shape
   */
  export type Options<
    M extends Contracts.Intent.Map,
    C extends Contracts.Cursor.Map<M>,
    P extends string,
    R extends Contracts.Result.Base,
  > = {
    /** Target key used to store the serialized string representation of snapshots. */
    key: string

    /** Schema version identifier. Increment when changing models to run safe migrations. */
    version: number

    /** Milliseconds to wait before writing changes to disk (throttling storage writes). */
    debounceMs?: number

    /** Target storage adapter (e.g. LocalStorageAdapter, IndexedDBAdapter). */
    adapter: Adapter

    /**
     * Optional custom serialization mapper.
     */
    serialize?: (state: Engine.State<M, C, P, R>, version: number) => Snapshot<M, C, P>

    /**
     * Optional custom deserialization mapper.
     */
    deserialize?: (raw: unknown, ctx: DeserializeContext<M, P>) => Engine.State<M, C, P, R> | null

    /**
     * Runtime validation guard for purpose strings. Required if using the default deserializer.
     */
    isPurpose?: ((value: string) => value is P) | undefined

    /**
     * Runtime validation guard for intent objects. Required if using the default deserializer.
     */
    isIntent?: ((value: unknown) => value is M[keyof M]) | undefined
  }

  /**
   * Plain-object representation of a stored upload item.
   * Files cannot be fully serialized; hence their binary metadata is stashed.
   */
  export type PersistedItem<M extends Contracts.Intent.Map, C extends Contracts.Cursor.Map<M>, P extends string> = {
    /** Unique client-side file identifier. */
    id: string
    /** Upload purpose. */
    purpose: P
    /** Target status phase key (e.g. `'uploading'`, `'paused'`). */
    status: string
    /** Serialized metadata of the file. */
    file: {
      /** Base name. */
      name: string
      /** Size in bytes. */
      size: number
      /** Claimed MIME type. */
      type: string
      /** Mod date timestamp in ms. */
      lastModified: number
      /** Checksum fingerprint hash if calculated. */
      checksum?: string | undefined
    }
    /** The active backend intent payload. */
    intent: Contracts.Intent.Any<M>
    /** Strategy-defined resume cursor state. */
    cursor?: Contracts.Cursor.Any<C> | undefined
    /** Current progress measurements. */
    progress?:
      | {
          uploadedBytes: number
          totalBytes: number
          pct?: number | undefined
        }
      | undefined
  }

  /**
   * A minimal, serializable representation of an upload item that is safe to store
   * in persistence (LocalStorage, IndexedDB, etc).
   *
   * @typeParam M - Map of upload intent variants keyed by intent kind (e.g. `direct`, `multipart`).
   * @typeParam C - Map of cursor shapes keyed by {@link M}'s intent kinds.
   * @typeParam P - Union of allowed `purpose` strings for your app (e.g. `"avatar" | "document"`).
   */
  export type Snapshot<M extends Contracts.Intent.Map, C extends Contracts.Cursor.Map<M>, P extends string> = {
    /** Persistence schema version (not app version). */
    version: number
    /** Unix epoch milliseconds when this snapshot was written. */
    createdAt: number
    /** List of persisted upload items. */
    items: Record<string, PersistedItem<M, C, P>>
  }

  /**
   * Driver interface for persisting upload store snapshots.
   */
  export type Adapter = {
    /**
     * Resolves and returns the stored snapshot payload.
     * Can return null if no snapshot exists.
     */
    load(key: string): unknown | null | Promise<unknown | null>

    /**
     * Saves a snapshot payload to the target storage location.
     */
    save(key: string, snapshot: unknown): void | Promise<void>

    /**
     * Deletes the snapshot record.
     */
    clear(key: string): void | Promise<void>
  }
}
