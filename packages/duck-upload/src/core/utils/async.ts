/**
 * Awaitable timer. Clamps `ms` to `[0, 86_400_000]` (24h) so a NaN /
 * Infinity / negative argument can't wedge the scheduler.
 */
export function sleep(ms: number): Promise<void> {
  const clamped = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 86_400_000) : 0
  return new Promise<void>((resolve) => setTimeout(resolve, clamped))
}
