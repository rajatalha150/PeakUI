import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_MAX_IP_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  checkLoginRateLimit,
  clearLoginFailures,
  getLoginRateLimitKey,
  recordLoginFailure,
  resetAllLoginRateLimits,
} from './login-rate-limit'

describe('login-rate-limit', () => {
  beforeEach(() => {
    resetAllLoginRateLimits()
  })

  it('builds a normalized rate-limit key from x-forwarded-for, x-real-ip, or local fallback', () => {
    const reqForwarded = new Request('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    })
    expect(getLoginRateLimitKey(reqForwarded, '  AdminUser  ')).toBe('203.0.113.10:adminuser')

    const reqRealIp = new Request('http://localhost/api/auth/login', {
      headers: { 'x-real-ip': '198.51.100.7' },
    })
    expect(getLoginRateLimitKey(reqRealIp, 'Alice')).toBe('198.51.100.7:alice')

    const reqLocal = new Request('http://localhost/api/auth/login')
    expect(getLoginRateLimitKey(reqLocal, 'bob')).toBe('local:bob')
  })

  it('allows attempts below LOGIN_RATE_LIMIT_MAX_ATTEMPTS and locks out after reaching the threshold', () => {
    const key = '203.0.113.10:alice'
    const t0 = 1_000_000

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 1; i++) {
      recordLoginFailure(key, t0 + i * 1000)
      const status = checkLoginRateLimit(key, t0 + i * 1000)
      expect(status.allowed).toBe(true)
      expect(status.retryAfterSeconds).toBe(0)
    }

    // 10th failed attempt triggers lockout
    recordLoginFailure(key, t0 + 9_000)
    const locked = checkLoginRateLimit(key, t0 + 9_000)
    expect(locked.allowed).toBe(false)
    expect(locked.retryAfterSeconds).toBe(Math.ceil((LOGIN_RATE_LIMIT_WINDOW_MS - 9_000) / 1000))
  })

  it('clears failures for a key when authentication succeeds', () => {
    const key = '203.0.113.10:alice'
    const t0 = 2_000_000

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      recordLoginFailure(key, t0 + i * 100)
    }
    expect(checkLoginRateLimit(key, t0 + 1000).allowed).toBe(false)

    clearLoginFailures(key)
    const afterClear = checkLoginRateLimit(key, t0 + 1000)
    expect(afterClear.allowed).toBe(true)
    expect(afterClear.retryAfterSeconds).toBe(0)
  })

  it('expires old failures once the sliding window passes', () => {
    const key = '203.0.113.10:alice'
    const t0 = 5_000_000

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      recordLoginFailure(key, t0 + i * 1000)
    }
    expect(checkLoginRateLimit(key, t0 + 10_000).allowed).toBe(false)

    // Advance past the first failure's 15-minute window
    const afterFirstExpires = t0 + LOGIN_RATE_LIMIT_WINDOW_MS + 1
    const unlocked = checkLoginRateLimit(key, afterFirstExpires)
    expect(unlocked.allowed).toBe(true)
    expect(unlocked.retryAfterSeconds).toBe(0)
  })

  it('enforces the secondary per-IP guard across multiple usernames', () => {
    const t0 = 10_000_000
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_IP_ATTEMPTS; i++) {
      recordLoginFailure(`198.51.100.99:user-${i}`, t0 + i * 100)
    }

    const blockedOnFreshUser = checkLoginRateLimit('198.51.100.99:brand-new-user', t0 + 5_000)
    expect(blockedOnFreshUser.allowed).toBe(false)
    expect(blockedOnFreshUser.retryAfterSeconds).toBeGreaterThan(0)

    const otherIpAllowed = checkLoginRateLimit('198.51.100.100:brand-new-user', t0 + 5_000)
    expect(otherIpAllowed.allowed).toBe(true)
  })
})
