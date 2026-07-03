<p align="center">
  <img src="../../public/logo-dark.svg" alt="@gentleduck/upload" width="120"/>
</p>

<h1 align="center">@gentleduck/upload</h1>

<p align="center">
  Headless, framework-agnostic file-upload engine with a typed state machine, pluggable strategies, and React bindings.
</p>

<p align="center">
  <a href="../../LICENSE">MIT</a> -
  <a href="../../CHANGELOG.md">Changelog</a> -
  <a href="../../CONTRIBUTING.md">Contributing</a> -
  <a href="https://gentleduck.org/duck-upload">Docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@gentleduck/upload"><img src="https://img.shields.io/npm/v/@gentleduck/upload.svg" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@gentleduck/upload"><img src="https://img.shields.io/npm/dm/@gentleduck/upload.svg" alt="downloads"/></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/npm/l/@gentleduck/upload.svg" alt="MIT"/></a>
</p>

---

A pure-reducer core, persistence-aware and resume-after-refresh, with bounded upload
concurrency and zero coupling to a specific backend or UI library. The engine stays
protocol-agnostic: your backend returns an intent, the engine dispatches on its `strategy` field
to a registered strategy that moves the bytes.

## Install

```sh
bun add @gentleduck/upload
# peer deps for the React bindings
bun add react react-dom
```

## Quick Start

```ts
import { createUploadStore } from '@gentleduck/upload/core'
import { PutStrategy, createStrategyRegistry } from '@gentleduck/upload/strategies'

type Intents = { put: PutStrategy.Intent }
type Cursors = { put?: PutStrategy.Cursor }
type Purpose = 'attachment'
type Result = { fileId: string; key: string }

const strategies = createStrategyRegistry<Intents, Cursors, Purpose, Result>()
strategies.set(PutStrategy({ allowedHosts: ['uploads.example.com'] }))

const store = createUploadStore<Intents, Cursors, Purpose, Result>({
  strategies,
  api: {
    // Ask your backend to presign the upload.
    async createIntent({ filename, contentType, size }) {
      const res = await fetch('/api/sign', {
        method: 'POST',
        body: JSON.stringify({ filename, contentType, size }),
      })
      return res.json() // -> { strategy: 'put', fileId, url, headers? }
    },
    // Finalize once the bytes are transferred.
    async complete({ fileId }) {
      return { fileId, key: `attachments/${fileId}` }
    },
  },
  config: { maxConcurrentUploads: 3, autoStart: ['attachment'] },
})

store.dispatch({ type: 'addFiles', files, purpose: 'attachment' })
```

The `createXHRTransport()` browser transport is installed automatically. Pass
`transport: createFetchTransport()` to run in Node / SSR / edge / workers.

## Strategies

A strategy is the thin layer that turns an intent into network calls. Four ship built in;
register the ones you need and let `createIntent` pick per file.

| Strategy | Factory | Use case | Resumable |
| --- | --- | --- | --- |
| PUT | `PutStrategy(opts?)` | Single presigned PUT (S3 `putObject`, signed PUT) | No |
| POST | `PostStrategy(opts?)` | Presigned `multipart/form-data` (S3 POST policy) | No |
| Multipart | `multipartStrategy(opts?)` | Large files, concurrent parts, per-part resume | Yes |
| tus | `TusStrategy(opts?)` | Resumable uploads over the tus protocol | Yes |

```ts
import {
  PutStrategy,
  PostStrategy,
  multipartStrategy,
  TusStrategy,
  createStrategyRegistry,
} from '@gentleduck/upload/strategies'

const strategies = createStrategyRegistry<Intents, Cursors, Purpose, Result>()
strategies.set(PutStrategy({ allowedHosts: ['uploads.example.com'] }))
strategies.set(PostStrategy())
strategies.set(multipartStrategy({ maxPartConcurrency: 4 }))
strategies.set(TusStrategy({ allowedHosts: ['tus.example.com'] }))
```

Every backend-supplied URL (PUT / POST / multipart part / tus) runs through the `validateUploadUrl`
SSRF guard before any byte leaves the client. Set `allowedHosts` to lock the host; keep
`allowPrivateHosts` at its default `false` to block loopback / RFC1918 / cloud-metadata targets.
`PutStrategy`, `PostStrategy`, and `TusStrategy` retry transient network failures
(timeouts / 5xx / `ECONNRESET`) with exponential backoff.

## React

```tsx
import {
  UploadProvider,
  useUploader,
  useDropzone,
} from '@gentleduck/upload/react'

function Uploader() {
  const { getRootProps, getInputProps, isDragging } = useDropzone({
    purpose: 'attachment',
    accept: 'image/*,.pdf',
  })
  const { items, dispatch } = useUploader<Intents, Cursors, Purpose, Result>()

  return (
    <div {...getRootProps()} data-active={isDragging}>
      <input {...getInputProps()} />
      {items.map((item) => (
        <Row
          key={item.localId}
          item={item}
          onCancel={() => dispatch({ type: 'cancel', localId: item.localId })}
        />
      ))}
    </div>
  )
}

// Wrap once so descendants can reach the store.
<UploadProvider store={store}>
  <Uploader />
</UploadProvider>
```

React exports: `UploadProvider`, `useUploader`, `useUploaderActions`, `useDropzone`,
`createUploadFactory`, `useUploadStore`, `isUploadStore` (plus the pure helpers
`fileMatchesAccept`, `matchesAcceptToken`, `selectFiles`).

## Subpath Exports

```ts
import { createUploadStore, createFetchTransport } from '@gentleduck/upload/core'
import { UploadProvider, useUploader, useDropzone } from '@gentleduck/upload/react'
import { PutStrategy, TusStrategy, createStrategyRegistry } from '@gentleduck/upload/strategies'
```

## Features

- **Pure reducer** — command/event-driven state machine; effects are isolated.
- **Typed end-to-end** — intents, cursors, purposes, and results are quad-generics threaded
  through the engine (`M`, `C`, `P`, `R`).
- **Four built-in strategies** — PUT, POST, multipart, tus — plus a registry for your own.
- **Two transports** — `createXHRTransport()` (browser, real upload progress) and
  `createFetchTransport()` (Node / SSR / edge / workers), with optional `get()` streaming
  download and `head()`.
- **Resume after refresh** — Memory / LocalStorage / IndexedDB persistence adapters; cursor-aware
  re-binding via the `rebind` command.
- **Retry policy** — exponential backoff with per-phase attempt escalation (intent / upload /
  complete), overridable via `config.retryPolicy`.
- **Bounded concurrency** — `config.maxConcurrentUploads` caps parallel uploads; queued items
  wait for a free slot.
- **Content dedupe, off-thread** — SHA-256 checksums hash inline for small files and
  incrementally in a Web Worker for large ones, so `checksumMaxSize` is a boundary, not a skip —
  big files stay deduplicated without freezing the UI.
- **Headless React** — `useDropzone` gives drag-and-drop + file-picker prop getters with zero
  markup or styling.
- **SSRF guard built in** — allowlist + protocol + IPv4/IPv6 private + cloud-metadata + NAT64 +
  6to4 + IPv4-mapped checks on every upload URL.
- **Filename + MIME hardening** — NFKC normalize, control-char strip, Windows reserved-name +
  255-char + path-sep rejection; magic-byte sniff cross-checks the claimed `file.type`.
- **NaN-safe configs** — every numeric option clamps `NaN` / `Infinity` / negative to its
  default; persisted snapshots reject `NaN` fields.
- **No DOM coupling** — runs in Workers, Node 22+, or the browser.
- **Threat model + audit** — STRIDE-mapped `THREAT-MODEL.md` and re-runnable `AUDIT-RESULTS.md`
  checked into the package.

## Persistence

Persistence lets a paused or in-flight upload survive a refresh: the snapshot is stored, and a
`rebind` re-attaches a fresh `File` (validated by fingerprint) so a resumable strategy continues
from its cursor.

```ts
import { createUploadStore, IndexedDBAdapter } from '@gentleduck/upload/core'

createUploadStore({
  strategies,
  api,
  persistence: {
    key: 'app:uploads',
    version: 1,
    adapter: IndexedDBAdapter, // or LocalStorageAdapter / createMemoryAdapter()
    isPurpose,
    isIntent,
  },
})
```

Adapters: `IndexedDBAdapter` and `LocalStorageAdapter` (shared singletons), `MemoryAdapter`
(shared) or `createMemoryAdapter()` (isolated per store). Bump `persistence.version` in lockstep
across tabs/deployments; a snapshot at a different version is rejected by `deserializeSnapshot`'s
version fence rather than loaded.

## Writing a custom strategy

A strategy implements one `start()` against the `Contracts.Strategy.Me` contract. `id` must equal
the intent's `strategy` field; `resumable` is metadata for your UI. Honor `signal`, call
`reportProgress`, and — if resumable — `persistCursor` at each safe boundary.

```ts
import type { Contracts } from '@gentleduck/upload/core'

type Intents = { myput: { strategy: 'myput'; fileId: string; url: string } }
type Cursors = { myput?: Record<string, never> }
type Purpose = 'attachment'
type Result = { fileId: string; key: string }

const myPut: Contracts.Strategy.Me<Intents, Cursors, Purpose, Result, 'myput'> = {
  id: 'myput',
  resumable: false,
  async start(ctx) {
    await ctx.transport.put({
      url: ctx.intent.url,
      body: ctx.file,
      signal: ctx.signal,
      onProgress: (uploadedBytes, totalBytes) => ctx.reportProgress({ uploadedBytes, totalBytes }),
    })
  },
}

strategies.set(myPut)
```

`start()` is awaited: resolve → the engine transitions to `completing`; throw → the error routes
through `errorNormalizer` + `retryPolicy`. The `ctx` also carries `intent`, `api`, `readCursor`,
`persistCursor`, `attempt`, and the injected `transport` (`put` / `postForm` / `patch` and the
optional `get` / `head`). Use `api.multipart.signPart` / `completeMultipart` for backend
round-trips a strategy needs mid-flight.

## Commands

Dispatch via `store.dispatch(cmd)`.

| Command | Purpose |
| --- | --- |
| `addFiles` | Validate + insert; schedules checksum + intent |
| `start` / `startAll` | Move ready items to queued (batched) |
| `pause` / `pauseAll` | Abort inflight, persist cursor (batched) |
| `resume` | Re-queue a paused item |
| `cancel` / `cancelAll` | Abort and mark canceled (batched) |
| `retry` | Re-attempt the failed phase, bumping the attempt counter |
| `rebind` | Re-attach a fresh `File` after refresh (fingerprint-validated) |
| `remove` | Drop the item from state |

## Events

Subscribe via `store.on(type, cb)`; payloads are typed from the engine's event map.

- `file.added`, `file.rejected`
- `validation.ok`, `validation.failed`
- `intent.creating`, `intent.created`, `intent.failed`
- `upload.queued`, `upload.started`, `upload.progress`, `upload.cursor`
- `upload.paused`, `upload.resumed`, `upload.canceled`
- `upload.completing`, `upload.completed`, `upload.error`

## Bundler requirement

The engine references `process.env.NODE_ENV` to gate dev-only invariant warnings. Vite / Webpack /
Rspack / esbuild / Rollup replace this at build time and ship a single branch to production.
Pure-ESM consumers loading the source without a bundler must set
`globalThis.process = { env: { NODE_ENV: 'production' } }` before importing the package.

## Tests

```bash
bun run test
```

The Vitest suite covers the reducer state machine, persistence, every strategy and transport, the
incremental hasher, the SSRF/filename/MIME guards, and the React helpers.

## License

MIT
