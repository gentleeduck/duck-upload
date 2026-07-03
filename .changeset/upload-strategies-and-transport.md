---
"@gentleduck/upload": minor
---

Add PUT, tus, and a fetch transport; hash large files off-thread.

- **`PutStrategy`** — single-request presigned HTTP PUT (S3 `putObject`, GCS/Azure signed PUT). SSRF-guarded with `allowedHosts`/`allowPrivateHosts` and transient-error retry.
- **`TusStrategy`** — creation-less tus resumable uploads. HEAD reads the server `Upload-Offset`, then chunked `PATCH` with `application/offset+octet-stream`; the offset is persisted in the cursor for resume.
- **`createFetchTransport`** — `fetch`-based transport for Node/SSR/edge/worker runtimes, plus an optional streaming `get()` download and `head()` on both transports.
- **Large-file checksums** — files above `checksumMaxSize` are now hashed incrementally (SHA-256) off the main thread via a Web Worker instead of being skipped, so dedupe covers files of any size without freezing the UI.
- **Retries** — `PostStrategy` now retries transient network failures (shared backoff helper, previously multipart-only).
- **`useDropzone`** — headless React drag-and-drop / file-picker hook. Prop-getters for the drop target and hidden input, an `isDragging` flag, `accept` filtering, and single/multiple selection; dispatches `addFiles` (or a custom `onFiles`).
