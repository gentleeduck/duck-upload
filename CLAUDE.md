# Duck Upload

## Overview

Duck Upload (`duck-upload`) is a modular, strategy-based file upload engine with React bindings. It is maintained under the `@gentleduck` scope and published to npm.

## Monorepo Structure

| Path | Description |
|------|-------------|
| `apps/duck-upload-docs` | Next.js documentation site (Velite for content) |
| `packages/duck-upload` | Core upload engine and React bindings |
| `tooling/biome` | Shared Biome (linter/formatter) config |
| `tooling/tailwind` | Shared Tailwind CSS config |
| `tooling/tsdown` | Shared tsdown (bundler) config |
| `tooling/typescript` | Shared TypeScript config |
| `tooling/vitest` | Shared Vitest config |
| `tooling/bash` | Shell utilities |
| `tooling/github` | GitHub Actions and CI helpers |

## Prerequisites

- **Node** >= 22
- **Bun** 1.3.5 (set via `packageManager`)
- **Turbo** for task orchestration

## Common Commands

```sh
bun install          # install dependencies
bun run dev          # start all apps/packages in dev mode (turbo)
bun run build        # production build (turbo)
bun run test         # run tests (turbo)
bun run check        # biome check (lint + format)
bun run lint         # biome lint only
bun run format       # biome format --write
bun run fix          # biome check --write (auto-fix)
bun run check-types  # typecheck all packages (turbo)
bun run lint:ws      # workspace lint via sherif
bun run changeset    # create a changeset
bun run release      # build + changeset publish
```

## Dev Tools

### React Grab

React Grab is loaded automatically in the docs app during development (`NODE_ENV === 'development'`). The script tag is in `apps/duck-upload-docs/app/layout.tsx` alongside React Scan:

```tsx
{process.env.NODE_ENV === 'development' && (
  <>
    <script crossOrigin="anonymous" src="//unpkg.com/react-scan/dist/auto.global.js" />
    <script crossOrigin="anonymous" src="//unpkg.com/react-grab/dist/index.global.js" />
  </>
)}
```

No additional configuration is required; it activates on page load in dev mode.

## Conventions

- **Package manager**: Bun (do not use npm/yarn/pnpm).
- **Linting & formatting**: Biome (`biome.json` at repo root). Run `bun run fix` before committing.
- **Changesets**: Every user-facing change needs a changeset (`bun run changeset`).
- **TypeScript**: Strict mode. Shared base config in `tooling/typescript`.
- **Bundling**: `tsdown` for library packages. Config shared via `tooling/tsdown`.
- **Testing**: Vitest. Shared config in `tooling/vitest`.
- **Styling**: Tailwind CSS v4. Shared config in `tooling/tailwind`.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
