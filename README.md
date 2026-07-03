<p align="center">
  <img src="./public/logo-dark.svg" alt="@gentleduck/upload" width="120"/>
</p>

<h1 align="center">@gentleduck/upload</h1>

<p align="center">
  Resumable, strategy-based file upload engine. PUT / POST / multipart / tus strategies, abort &amp; resume, XHR + fetch transports, React bindings.
</p>

<p align="center">
  <a href="./LICENSE">MIT</a> -
  <a href="./CHANGELOG.md">Changelog</a> -
  <a href="./CONTRIBUTING.md">Contributing</a> -
  <a href="https://gentleduck.org/duck-upload">Docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@gentleduck/upload"><img src="https://img.shields.io/npm/v/@gentleduck/upload.svg" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@gentleduck/upload"><img src="https://img.shields.io/npm/dm/@gentleduck/upload.svg" alt="downloads"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@gentleduck/upload.svg" alt="MIT"/></a>
</p>

---

## Install

```sh
bun add @gentleduck/upload
```

## Quick start

```ts
import { createUploadStore } from '@gentleduck/upload/core'
import { PutStrategy, createStrategyRegistry } from '@gentleduck/upload/strategies'

const strategies = createStrategyRegistry()
strategies.set(PutStrategy({ allowedHosts: ['uploads.example.com'] }))

const store = createUploadStore({
  strategies,
  api: {
    async createIntent({ filename, contentType, size }) {
      const res = await fetch('/api/sign', {
        method: 'POST',
        body: JSON.stringify({ filename, contentType, size }),
      })
      return res.json() // -> { strategy: 'put', fileId, url, headers? }
    },
    async complete({ fileId }) {
      return { fileId, key: `uploads/${fileId}` }
    },
  },
  config: { maxConcurrentUploads: 3, autoStart: ['avatar'] },
})

store.dispatch({ type: 'addFiles', files, purpose: 'avatar' })
```

### React

```tsx
import { useDropzone, useUploader } from '@gentleduck/upload/react'

function Avatar() {
  const { getRootProps, getInputProps } = useDropzone({ purpose: 'avatar', accept: 'image/*' })
  const { uploading } = useUploader()
  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      {uploading.length > 0 && <span>uploading…</span>}
    </div>
  )
}
```

See the [package README](packages/duck-upload/README.md) for the full API.

## Workspace

| Path | Package | Role |
| --- | --- | --- |
| [`packages/duck-upload`](packages/duck-upload) | [`@gentleduck/upload`](https://www.npmjs.com/package/@gentleduck/upload) | Core engine, strategies, React bindings |

### Subpath exports

| Subpath | Target |
| --- | --- |
| `@gentleduck/upload` | Top-level public API (core + react + strategies) |
| `@gentleduck/upload/core` | Engine, contracts, persistence, errors, XHR + fetch transports |
| `@gentleduck/upload/react` | React provider + hooks (`useUploader`, `useDropzone`) |
| `@gentleduck/upload/strategies` | `PutStrategy`, `PostStrategy`, `multipartStrategy`, `TusStrategy`, registry |

## Build

```sh
bun install
bunx turbo run build --filter='./packages/*'
bunx turbo run test --filter='./packages/*'
bunx turbo run check-types --filter='./packages/*'
```

## Docs

- Site: [gentleduck.org/duck-upload](https://gentleduck.org/duck-upload)
- Sibling repos: [`@gentleduck/ui`](https://github.com/gentleeduck/duck-ui), [`@gentleduck/iam`](https://github.com/gentleeduck/duck-iam), [`@gentleduck/md`](https://github.com/gentleeduck/duck-md)

## Contributing

PR checklist + style notes in [`CONTRIBUTING.md`](CONTRIBUTING.md).
Security: [`SECURITY.md`](SECURITY.md). Behaviour: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT. See [`LICENSE`](LICENSE).
