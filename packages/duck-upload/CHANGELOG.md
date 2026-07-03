# @gentleduck/upload

## 0.3.0

### Minor Changes

- 8a478ef: Add PUT, tus, and a fetch transport; hash large files off-thread.

  - **`PutStrategy`** — single-request presigned HTTP PUT (S3 `putObject`, GCS/Azure signed PUT). SSRF-guarded with `allowedHosts`/`allowPrivateHosts` and transient-error retry.
  - **`TusStrategy`** — creation-less tus resumable uploads. HEAD reads the server `Upload-Offset`, then chunked `PATCH` with `application/offset+octet-stream`; the offset is persisted in the cursor for resume.
  - **`createFetchTransport`** — `fetch`-based transport for Node/SSR/edge/worker runtimes, plus an optional streaming `get()` download and `head()` on both transports.
  - **Large-file checksums** — files above `checksumMaxSize` are now hashed incrementally (SHA-256) off the main thread via a Web Worker instead of being skipped, so dedupe covers files of any size without freezing the UI.
  - **Retries** — `PostStrategy` now retries transient network failures (shared backoff helper, previously multipart-only).
  - **`useDropzone`** — headless React drag-and-drop / file-picker hook. Prop-getters for the drop target and hidden input, an `isDragging` flag, `accept` filtering, and single/multiple selection; dispatches `addFiles` (or a custom `onFiles`).

## 0.2.6

### Patch Changes

- 4950212: Stabilize the published React declaration surface by giving `useUploaderActions()` an explicit return type and align the shared tsdown config package with the repo's runtime tsdown version.

## 0.2.5

### Patch Changes

- 918b34c: Strip `workspace:*` and `catalog:` protocol tokens from `devDependencies`/`dependencies`/`peerDependencies` of every public package before `changeset publish`. Previously published artifacts leaked these tokens into npm metadata, which broke strict resolvers (bun, deno) for downstream consumers. Adds `scripts/clean-publish.ts` and wires it into the root `release` script with a `git checkout` restore step so source remains workspace-friendly.

## 0.2.4

### Patch Changes

- 0acb667: Point package `exports` at compiled `./dist/*` output instead of `./src/*.ts` source. Add multi-entry build (`index`, `core`, `react`, `strategies`) so subpath imports work for non-bundler consumers (e.g. NestJS via Node CJS). Fixes runtime `SyntaxError` when consumed by apps that don't transpile package source.

## 0.2.2

### Patch Changes

- 0d9dc94: Add publishConfig with public access for scoped npm package.

## 0.2.1

### Patch Changes

- 97606b5: Fix release workflow to skip redundant CI checks during publish.

## 0.2.0

### Minor Changes

- 7c4d70c: Initial release of @gentleduck/upload - a resumable, strategy-based file upload engine for the browser.
