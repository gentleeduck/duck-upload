<h1 align="center">@gentleduck/upload</h1>

<p align="center">
  Resumable, strategy-based file upload engine for the browser. POST + multipart strategies, abort/resume, React bindings.
</p>

<p align="center">
  <a href="./LICENSE">MIT</a> -
  <a href="./CHANGELOG.md">Changelog</a> -
  <a href="./CONTRIBUTING.md">Contributing</a> -
  <a href="https://upload.gentleduck.org">Docs</a>
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
import { createUploadEngine, PostStrategy, multipartStrategy } from '@gentleduck/upload'

const engine = createUploadEngine({
  strategies: [PostStrategy(), multipartStrategy()],
  backend: { url: '/api/uploads' },
})

await engine.upload(file, { strategy: 'multipart', purpose: 'avatar' })
```

### React

```tsx
import { useUpload } from '@gentleduck/upload/react'

function Avatar() {
  const { upload, progress, status } = useUpload({ purpose: 'avatar' })
  return <input type="file" onChange={(e) => upload(e.target.files![0])} />
}
```

## Workspace

| Path | Package | Role |
| --- | --- | --- |
| [`packages/duck-upload`](packages/duck-upload) | [`@gentleduck/upload`](https://www.npmjs.com/package/@gentleduck/upload) | Core engine, strategies, React bindings |

### Subpath exports

| Subpath | Target |
| --- | --- |
| `@gentleduck/upload` | Top-level public API |
| `@gentleduck/upload/core` | Engine, contracts, fingerprint |
| `@gentleduck/upload/react` | React hooks + provider |
| `@gentleduck/upload/strategies` | `PostStrategy`, `multipartStrategy`, registry |

## Apps

| Path | Role |
| --- | --- |
| [`apps/duck-upload-docs`](apps/duck-upload-docs) | Docs site at [upload.gentleduck.org](https://upload.gentleduck.org) |

## Build

```sh
bun install
bunx turbo run build --filter='./packages/*'
bunx turbo run test --filter='./packages/*'
bunx turbo run check-types --filter='./packages/*'
```

## Docs

- Site: [upload.gentleduck.org](https://upload.gentleduck.org)
- Sibling repos: [`@gentleduck/ui`](https://github.com/gentleeduck/duck-ui), [`@gentleduck/iam`](https://github.com/gentleeduck/duck-iam), [`@gentleduck/md`](https://github.com/gentleeduck/duck-md)

## Contributing

PR checklist + style notes in [`CONTRIBUTING.md`](CONTRIBUTING.md).
Security: [`SECURITY.md`](SECURITY.md). Behaviour: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT. See [`LICENSE`](LICENSE).
