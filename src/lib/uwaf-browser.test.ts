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

describe('uwaf-browser: detectLoginRequirement', () => {
  it('does NOT flag a DuckDuckGo-style SERP that merely mentions "email"', async () => {
    const { __test__ } = await loadUwafBrowser()
    // Real DDG markdown includes "Email Protection" in the footer. The old
    // bare /\bemail\b/ pattern false-positived here, marking a public search
    // page as "requires authentication."
    const markdown = 'DuckDuckGo\nSearch the web privately.\nEmail Protection\nPrivacy in your inbox.'
    const forms = [{ index: 0, method: 'GET', action: 'https://duckduckgo.com/', fields: [{ name: 'q', type: 'text' }] }]
    expect(__test__.detectLoginRequirement('results', markdown, forms as any)).toBe(false)
  })

  it('does NOT flag a "best password managers" article (bare "password")', async () => {
    const { __test__ } = await loadUwafBrowser()
    const markdown = 'The best password managers of 2026 — reviews and ratings.'
    expect(__test__.detectLoginRequirement('Best Password Managers', markdown, [])).toBe(false)
  })

  it('flags a page with a visible password field (the strong signal)', async () => {
    const { __test__ } = await loadUwafBrowser()
    const forms = [{ index: 0, method: 'POST', action: '/login', fields: [{ name: 'password', type: 'password' }] }]
    expect(__test__.detectLoginRequirement('Account', '', forms as any)).toBe(true)
  })

  it('flags a JS-rendered login page by its "Sign in" phrase', async () => {
    const { __test__ } = await loadUwafBrowser()
    const markdown = 'Welcome back. Sign in to your account to continue.'
    expect(__test__.detectLoginRequirement('Sign In', markdown, [])).toBe(true)
  })

  it('flags "enter your password" phrase (contextual, not bare)', async () => {
    const { __test__ } = await loadUwafBrowser()
    const markdown = 'Please enter your password to access the dashboard.'
    expect(__test__.detectLoginRequirement('Login', markdown, [])).toBe(true)
  })

  it('does NOT flag a Barchart-style page whose only login signal is a "Log In" nav link', async () => {
    const { __test__ } = await loadUwafBrowser()
    // A commercial site's nav often carries "Log In" / "Sign In" links AND a
    // "Sign Up" button, while the actual page body is usable market data.
    // There is no password field on this page (the link points elsewhere).
    // The old bare /\blog\s*in\b/ pattern marked this as auth-gated and made
    // the model abandon a working source.
    const markdown = [
      'Barchart | Stocks, Futures and Forex',
      'Log In  Sign Up  Markets  Options  Futures',
      'Most Active Options — high implied volatility movers for today.',
      'AAPL  Vol 45,231  IV 38.2%  Open Int 12,000',
    ].join('\n')
    const forms = [{ index: 0, method: 'GET', action: '/search', fields: [{ name: 'q', type: 'text' }] }]
    expect(__test__.detectLoginRequirement('Barchart', markdown, forms as any)).toBe(false)
  })

  it('does NOT flag a bare "Sign In" nav button with no login form', async () => {
    const { __test__ } = await loadUwafBrowser()
    const markdown = 'Sign In  Products  Pricing  Docs  Contact'
    expect(__test__.detectLoginRequirement('Acme', markdown, [])).toBe(false)
  })

  it('flags a "log in to your account" phrase (page-body, not nav)', async () => {
    const { __test__ } = await loadUwafBrowser()
    const markdown = 'Welcome back — log in to your account to view your portfolio.'
    expect(__test__.detectLoginRequirement('Login', markdown, [])).toBe(true)
  })
})
