# Agent Guidelines for @duck-upload Workspace

## TypeScript Design Guidelines

- **Minimize Type Redundancy & Duplication**: Reuse core type models (e.g., from `Engine.Item`, `Engine.EventMap`, or `Store.Me`) using TypeScript utility types like `Pick`, `Omit`, `Extract`, or key-indexing rather than redefining duplicated matching structures. Keep types DRY.
- **Enforce Bracket Access for Index Signatures**: Under `noPropertyAccessFromIndexSignature`, enforce bracket-based property access for index signature records (e.g. `obj['prop']` instead of `obj.prop`).
- **Handle Exact Optional Property Types**: When `exactOptionalPropertyTypes` is enabled, explicitly define union types accepting `| undefined` for optional parameters and keys that can return or hold undefined values.
- **Sensible Defaults**: Maintain configuration helpers (like `resolveUploadConfig`) that merge default constants to make setup straightforward for developers.
