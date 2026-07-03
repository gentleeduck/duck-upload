# Dependency Audit - `@gentleduck/upload`

Run date: 2026-05-29
Tool: `bun audit` (bun 1.3.10)

## Result

**0 vulnerabilities reported.**

```
$ bun audit
No vulnerabilities found
```

## Scope

`bun audit` walks the full workspace dependency graph (production + dev). No advisories were reported for `@gentleduck/upload` itself or any of its dev / build tooling.

## What this does NOT mean

- This is `bun audit`, not a security audit. The tool reports KNOWN CVEs in installed dependency graphs. It cannot tell you whether the library source itself contains an undiscovered vulnerability.
- `bun audit` does not exercise crypto primitives. For that, see `THREAT-MODEL.md` §4 and the test suite in `src/__tests__/` (220+ tests) covering SSRF guards, NaN-bypass defenses, prototype-pollution defenses, magic-byte MIME sniffs, and filename sanitization.

## How to re-run

```bash
bun audit
```

## When to refresh this file

- After every `bun update --latest`
- Whenever a new package is added to `dependencies` or `peerDependencies`
- At every minor release

The intent of this file is to make "have you looked at the audit lately" a single grep + read instead of "did anyone actually look."
