import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

describe('captcha-solver', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.assign(process.env, originalEnv)
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  it('returns null when neither CAPTCHA_PROVIDER nor CAPTCHA_API_KEY is set', async () => {
    delete process.env.CAPTCHA_PROVIDER
    delete process.env.CAPTCHA_API_KEY
    const { solveCaptchaIfConfigured } = await import('./captcha-solver')
    const solution = await solveCaptchaIfConfigured({
      challengeUrl: 'https://example.com',
      userId: 'u1',
    })
    expect(solution).toBeNull()
  })

  it('returns null when CAPTCHA_PROVIDER is explicitly "none"', async () => {
    process.env.CAPTCHA_PROVIDER = 'none'
    process.env.CAPTCHA_API_KEY = 'sk_test'
    const { solveCaptchaIfConfigured, getCaptchaSolverConfig } = await import('./captcha-solver')
    expect(getCaptchaSolverConfig()).toBeNull()
    const solution = await solveCaptchaIfConfigured({
      challengeUrl: 'https://example.com',
      userId: 'u1',
    })
    expect(solution).toBeNull()
  })

  it('enforces per-user budget cap', async () => {
    process.env.CAPTCHA_PROVIDER = '2captcha'
    process.env.CAPTCHA_API_KEY = 'sk_test'
    process.env.CAPTCHA_BUDGET_USD_PER_USER = '0.001'
    process.env.CAPTCHA_BUDGET_RESET_HOURS = '24'
    const { solveCaptchaIfConfigured, getRemainingBudget } = await import('./captcha-solver')
    // A budget of $0.001 cannot afford a $0.003 solve.
    const remaining = getRemainingBudget('user-budget-test')
    expect(remaining.remainingUsd).toBeLessThan(0.003)
    const solution = await solveCaptchaIfConfigured({
      challengeUrl: 'https://example.com',
      userId: 'user-budget-test',
    })
    expect(solution).toBeNull()
  })

  it('detects common challenge page signatures', async () => {
    const { looksLikeChallengePage } = await import('./captcha-solver')
    expect(looksLikeChallengePage('Just a moment…')).toBe(true)
    expect(looksLikeChallengePage('Checking your browser before accessing example.com.')).toBe(true)
    expect(looksLikeChallengePage('DDoS-Guard protection')).toBe(true)
    expect(looksLikeChallengePage(null)).toBe(false)
    expect(looksLikeChallengePage('Just a regular article about PeakUI features.')).toBe(false)
  })
})
