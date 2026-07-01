import { describe, expect, it, vi } from 'vitest'

async function loadUwafBrowser() {
  return await import('./uwaf-browser')
}

describe('uwaf-browser: runWithTimeout', () => {
  it('resolves with the work result when it finishes before the budget', async () => {
    const { __test__ } = await loadUwafBrowser()
    const result = await __test__.runWithTimeout(
      Promise.resolve({ value: 42 }),
      1000,
    )
    expect(result).toEqual({ value: 42, timedOut: false })
  })

  it('resolves with { timedOut: true } when the work exceeds the budget', async () => {
    const { __test__ } = await loadUwafBrowser()
    const slow = new Promise<{ value: number }>(resolve => {
      setTimeout(() => resolve({ value: 99 }), 500)
    })
    const start = Date.now()
    const result = await __test__.runWithTimeout(slow, 50)
    const wall = Date.now() - start
    expect(result).toEqual({ timedOut: true })
    // Resolved at ~50ms, not 500ms.
    expect(wall).toBeLessThan(200)
  })

  it('does not throw when the in-flight work rejects after timeout', async () => {
    const { __test__ } = await loadUwafBrowser()
    // Work that rejects *after* the timeout has fired. The runner
    // suppresses the late rejection (logged at debug).
    const lateReject = new Promise<{ value: number }>((_, reject) => {
      setTimeout(() => reject(new Error('late error')), 100)
    })
    const result = await __test__.runWithTimeout(lateReject, 10)
    expect(result).toEqual({ timedOut: true })
    // Wait a tick so the late rejection has time to be swallowed.
    await new Promise(r => setTimeout(r, 150))
  })

  it('exposes the per-provider fallback budget constant', async () => {
    const { __test__ } = await loadUwafBrowser()
    expect(__test__.PER_PROVIDER_FALLBACK_BUDGET_MS).toBe(8_000)
  })

  it('zero-budget still resolves with timeout (edge case)', async () => {
    const { __test__ } = await loadUwafBrowser()
    const result = await __test__.runWithTimeout(
      new Promise<{ value: number }>(resolve => setTimeout(() => resolve({ value: 1 }), 100)),
      0,
    )
    // With a 0ms budget, the timeout always wins (the work hasn't had
    // a chance to resolve synchronously in 0ms).
    expect(result).toEqual({ timedOut: true })
  })
})
