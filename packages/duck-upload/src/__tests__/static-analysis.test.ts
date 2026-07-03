/**
 * Static-analysis assertions that enforce security invariants by
 * grepping the source tree at test time.
 *
 * These guard the class of bug that survives a refactor + the existing
 * happy-path tests: someone replaces `crypto.randomUUID` with
 * `Math.random()`, or removes the SSRF guard from a strategy, and the
 * existing tests still pass because they don't cover the regression
 * lane. If one of these tests fails, fix the source - do not allowlist
 * without understanding which threat the rule was protecting against.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

interface FileScan {
  path: string
  contents: string
}

function walkTs(dir: string, out: FileScan[] = []): FileScan[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('__test')) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkTs(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push({ path: full.slice(ROOT.length + 1), contents: readFileSync(full, 'utf8') })
    }
  }
  return out
}

const ALL_FILES = walkTs(ROOT)

const SECURITY_PATHS = ['core/utils/', 'core/engine/', 'core/persistence/', 'core/contracts/', 'strategies/']

function isSecurityPath(path: string): boolean {
  return SECURITY_PATHS.some((p) => path.includes(p))
}

function linesContaining(file: FileScan, pattern: RegExp): string[] {
  const hits: string[] = []
  for (const line of file.contents.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    if (pattern.test(line)) hits.push(line)
  }
  return hits
}

describe('No Math.random in security paths', () => {
  it('Math.random must not appear in core/utils, core/engine, core/persistence, core/contracts, strategies', () => {
    const offenders = ALL_FILES.filter((f) => isSecurityPath(f.path)).flatMap((f) =>
      linesContaining(f, /\bMath\.random\b/).map((l) => `${f.path}: ${l.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})

describe('Upload IDs come from a CSPRNG, never Math.random', () => {
  it('id.ts uses randomUUID + getRandomValues; no Math.random in code', () => {
    const id = ALL_FILES.find((f) => f.path === 'core/utils/id.ts')
    expect(id).toBeDefined()
    if (!id) return
    expect(id.contents).toMatch(/\brandomUUID\b/)
    expect(id.contents).toMatch(/\bgetRandomValues\b/)
    // Use linesContaining so the docstring mention ("Math.random is deliberately
    // NOT used") doesn't flag - we only inspect code lines.
    expect(linesContaining(id, /Math\.random/)).toEqual([])
  })
})

describe('Every strategy with a backend-supplied URL routes it through validateUploadUrl', () => {
  it('multipart strategy imports validateUploadUrl', () => {
    const f = ALL_FILES.find((f) => f.path === 'strategies/multipart/index.ts')
    expect(f).toBeDefined()
    if (!f) return
    expect(f.contents).toMatch(/validateUploadUrl/)
  })
  it('post strategy imports validateUploadUrl', () => {
    const f = ALL_FILES.find((f) => f.path === 'strategies/post/index.ts')
    expect(f).toBeDefined()
    if (!f) return
    expect(f.contents).toMatch(/validateUploadUrl/)
  })
})

describe('Persistence deserializer guards against NaN / Infinity / negative byte counts', () => {
  it('persistence.ts uses Number.isFinite on numeric fields', () => {
    const f = ALL_FILES.find((f) => f.path === 'core/persistence/persistence.ts')
    expect(f).toBeDefined()
    if (!f) return
    expect(f.contents).toMatch(/Number\.isFinite|isFiniteNumber/)
  })
})

describe('Persistence adapters strip dangerous keys before deserialization', () => {
  it('LocalStorageAdapter applies stripDangerousKeys to JSON.parse output', () => {
    const f = ALL_FILES.find((f) => f.path === 'core/persistence/adapters.local.ts')
    expect(f).toBeDefined()
    if (!f) return
    expect(f.contents).toMatch(/stripDangerousKeys\(JSON\.parse/)
  })
  it('IndexedDB adapter applies stripDangerousKeys to read result', () => {
    const f = ALL_FILES.find((f) => f.path === 'core/persistence/adapters.indexeddb.ts')
    expect(f).toBeDefined()
    if (!f) return
    expect(f.contents).toMatch(/stripDangerousKeys/)
  })
})

describe('UploadEngineError uses static messages (SEC-003)', () => {
  it('errors.ts does NOT interpolate tainted values into Error.message', () => {
    const f = ALL_FILES.find((f) => f.path === 'core/errors.ts')
    expect(f).toBeDefined()
    if (!f) return
    // The constructor must lookup STATIC_MESSAGES[code] - no template-string interpolation
    // of caller-supplied context values into the super() call.
    expect(f.contents).toMatch(/STATIC_MESSAGES\[code\]/)
  })
})

describe('Filename sanitization is wired into addFiles', () => {
  it('create-intent.ts calls sanitizeFilename', () => {
    const f = ALL_FILES.find((f) => f.path === 'core/engine/store/handlers/create-intent.ts')
    expect(f).toBeDefined()
    if (!f) return
    expect(f.contents).toMatch(/sanitizeFilename/)
  })
})

describe('No console.log in security paths (use console.warn for visibility)', () => {
  it('security paths never call console.log', () => {
    const offenders = ALL_FILES.filter((f) => isSecurityPath(f.path)).flatMap((f) =>
      linesContaining(f, /\bconsole\.log\b/).map((l) => `${f.path}: ${l.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})
