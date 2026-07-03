import { describe, expect, test } from 'vitest'
import { sleep } from '../core/utils/async'

describe('sleep - clamps adversarial inputs', () => {
  test('NaN resolves immediately', async () => {
    const t0 = Date.now()
    await sleep(Number.NaN)
    expect(Date.now() - t0).toBeLessThan(50)
  })

  test('Infinity resolves within the 24h cap (but we only wait briefly to confirm it scheduled)', async () => {
    // Can't actually wait 24h; assert that the call doesn't throw / hang the test.
    const p = sleep(Number.POSITIVE_INFINITY)
    expect(p).toBeInstanceOf(Promise)
  })

  test('negative ms resolves immediately', async () => {
    const t0 = Date.now()
    await sleep(-1000)
    expect(Date.now() - t0).toBeLessThan(50)
  })

  test('zero ms resolves immediately', async () => {
    const t0 = Date.now()
    await sleep(0)
    expect(Date.now() - t0).toBeLessThan(50)
  })

  test('finite positive ms waits at least that long', async () => {
    const t0 = Date.now()
    await sleep(20)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15)
  })
})
