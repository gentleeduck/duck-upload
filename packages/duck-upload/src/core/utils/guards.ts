/**
 * Maximum recursion depth honored by {@link stripDangerousKeys}. Inputs
 * deeper than this are returned as-is — defends against pathological/cyclic
 * persistence payloads without aborting hydration.
 */
const MAX_STRIP_DEPTH = 16

const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Narrow guard for **plain** records (object literal / `Object.create(null)`).
 * Rejects arrays, `Date`, `Map`, `Set`, class instances, and any other exotic
 * object — only `null`-prototype or `Object.prototype` objects pass.
 *
 * Tightened for SEC-002: prevents arrays and class instances from being
 * spread into runtime state during snapshot hydration.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * Recursively strips `__proto__`, `constructor`, and `prototype` keys from a
 * value tree. Walks plain-object branches only — arrays are traversed, but
 * exotic objects (Date, Map, class instances) are returned untouched. Cycle-
 * and depth-safe: anything below {@link MAX_STRIP_DEPTH} levels is returned
 * as-is rather than throwing.
 *
 * Used on the output of `JSON.parse` before the parsed shape is spread into
 * runtime state (SEC-002).
 *
 * Iterative implementation — uses an explicit work stack so deeply nested
 * payloads cannot blow the call stack.
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
      // Exotic object (Date, Map, class instance, …) — leave it alone.
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
