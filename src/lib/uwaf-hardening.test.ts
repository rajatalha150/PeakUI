import { describe, expect, it } from 'vitest'
import {
  buildStealthFingerprint,
  getDefaultStealthProfile,
  normalizeStealthProfile,
} from './uwaf-fingerprint'
import {
  getStealthProviderCatalog,
  getPreferredSearchProviderLabel,
  getSearchProviderSnapshot,
  listSearchProviders,
  recordSearchProviderOutcome,
} from './uwaf-search-providers'
import { resolveStealthProfileForRequest } from './uwaf-browser'

describe('uwaf fingerprint hardening', () => {
  it('builds deterministic fingerprints for a stable seed', () => {
    const first = buildStealthFingerprint('normal', 'session:test-1')
    const second = buildStealthFingerprint('normal', 'session:test-1')
    expect(first.id).toBe(second.id)
    expect(first.userAgent).toBe(second.userAgent)
    expect(first.languages.length).toBeGreaterThan(0)
    expect(first.userAgentData.mobile).toBe(false)
  })

  it('normalizes explicit and heuristic stealth profiles', () => {
    expect(normalizeStealthProfile('high')).toBe('high')
    expect(normalizeStealthProfile('garbage')).toBe('normal')
    expect(resolveStealthProfileForRequest({
      action: 'open',
      url: 'http://exampleabc1234567890defghijklmnopqrstuvwxyzabcdefghijklmnop.onion',
    }, getDefaultStealthProfile())).toBe('high')
    expect(resolveStealthProfileForRequest({
      action: 'search',
      query: 'public sanctions list',
    }, 'normal')).toBe('normal')
    expect(resolveStealthProfileForRequest({
      action: 'search',
      query: 'what does the dark web say about XLE stock',
    }, 'normal')).toBe('normal')
    expect(resolveStealthProfileForRequest({
      action: 'search',
      query: 'retry with high stealth after bot blocks',
    }, 'normal')).toBe('high')
  })
})

describe('uwaf search provider resiliency', () => {
  it('prioritizes onion-aware providers for onion-heavy stealth queries', () => {
    const providers = listSearchProviders('stealth', 'latest onion mirrors for press freedom', 'normal')
    expect(providers.length).toBeGreaterThan(1)
    expect(providers[0].kind).toBe('onion')
  })

  it('limits stealth search to the approved onion-search engine set', () => {
    const providers = listSearchProviders('stealth', 'palantir dark web chatter', 'normal')
    const ids = providers.map(provider => provider.id)
    expect(ids).not.toContain('duckduckgo-lite')
    expect(ids).not.toContain('startpage')
    expect(ids).not.toContain('brave-search-stealth')
    expect(ids.every(id => getStealthProviderCatalog().some(entry => entry.id === id))).toBe(true)
  })

  it('degrades a provider after repeated hard failures and adjusts preference', () => {
    recordSearchProviderOutcome({
      providerId: 'ahmia',
      mode: 'stealth',
      durationMs: 2400,
      success: false,
      antiBotDetected: true,
      resultCount: 0,
      useful: false,
      error: 'anti-bot',
    })
    recordSearchProviderOutcome({
      providerId: 'ahmia',
      mode: 'stealth',
      durationMs: 2600,
      success: false,
      antiBotDetected: true,
      resultCount: 0,
      useful: false,
      error: 'anti-bot',
    })

    const preferred = getPreferredSearchProviderLabel('stealth', 'latest onion press leaks', 'normal')
    const snapshot = getSearchProviderSnapshot('stealth').find(provider => provider.id === 'ahmia')
    expect(snapshot?.degraded).toBe(true)
    expect(preferred).not.toBe('')
  })
})
