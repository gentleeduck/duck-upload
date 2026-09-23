/**
 * Maximum recursion depth for {@link stripDangerousKeys}. Values nested deeper
 * are left as-is, guarding against pathological or cyclic persistence payloads
 * without aborting hydration.
 */
const MAX_STRIP_DEPTH = 16

const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Narrow guard for plain records (object literal or `Object.create(null)`).
 * Rejects arrays, `Date`, `Map`, `Set`, and class instances — only
 * `null`-prototype or `Object.prototype` objects pass. Keeps arrays and class
 * instances out of runtime state during snapshot hydration.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * Safe `NODE_ENV === 'development'` check for dev-only diagnostics (console
 * warnings/errors that must never affect control flow).
 *
 * Bundlers that replace `process.env.NODE_ENV` (Vite, esbuild, webpack's
 * DefinePlugin) only match that exact dotted-property expression - a bare
 * `process` reference is never actually defined in the shipped browser
 * bundle. Reading `process.env['NODE_ENV']` (or any other form the bundler
 * doesn't statically match) throws `ReferenceError: process is not defined`
 * at runtime instead of the constant-folded string, turning a should-be-inert
 * dev warning into a hard crash. Guarding with `typeof process !== 'undefined'`
 * avoids ever touching the global unless something has actually defined it.
 */
export function isDevEnv(): boolean {
  return typeof window !== 'undefined' && typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'development'
}

/**
 * Recursively strip `__proto__`, `constructor`, and `prototype` keys from a
 * parsed value tree before it is spread into runtime state. Arrays are
 * traversed; exotic objects (Date, Map, class instances) are returned
 * untouched. Uses an explicit work stack so deeply nested payloads cannot
 * overflow the call stack, and stops at {@link MAX_STRIP_DEPTH} to stay cycle-
 * and depth-safe.
 */
export function stripDangerousKeys<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input

  type Frame = { value: object; depth: number }
  const stack: Frame[] = [{ value: input as unknown as object, depth: 0 }]
  const seen = new WeakSet<object>()

  while (stack.length > 0) {
    const frame = stack.pop()
    if (!frame) break

    const { value, depth } = frame
    if (seen.has(value)) continue
    seen.add(value)

    if (depth >= MAX_STRIP_DEPTH) continue

    if (Array.isArray(value)) {
      for (const child of value) {
        if (child !== null && typeof child === 'object') {
          stack.push({ value: child, depth: depth + 1 })
        }
      }
      continue
    }

    const proto = Object.getPrototypeOf(value)
    if (proto !== null && proto !== Object.prototype) {
      // Exotic object (Date, Map, class instance) — leave untouched.
      continue
    }

    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (DANGEROUS_KEYS.has(key)) {
        delete obj[key]
        continue
      }
      const child = obj[key]
      if (child !== null && typeof child === 'object') {
        stack.push({ value: child, depth: depth + 1 })
      }
    }
  }

  return input
}
