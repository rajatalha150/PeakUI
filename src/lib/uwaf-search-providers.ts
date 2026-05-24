import type { BrowserMode } from './uwaf-pool'
import type { StealthProfile } from './uwaf-fingerprint'

export interface UwafSearchProvider {
  id: string
  label: string
  mode: BrowserMode
  kind: 'general' | 'onion'
  priority: number
  resultsUrl: (query: string) => string
  homeUrl: string
  inputSelectors: string[]
  submitSelectors: string[]
  resultSelectors: string[]
  mirrors?: string[]
}

export interface UwafCuratedEntryPoint {
  id: string
  label: string
  url: string
  mode: BrowserMode
  tags: string[]
  source: 'built-in' | 'env'
}

interface ProviderState {
  attempts: number
  successes: number
  antiBotHits: number
  loginHits: number
  zeroResultHits: number
  usefulnessHits: number
  totalLatencyMs: number
  lastError?: string
  lastUsedAt?: string
  degradedUntil?: number
  consecutiveFailures: number
}

interface ProviderOutcome {
  providerId: string
  mode: BrowserMode
  durationMs: number
  success: boolean
  antiBotDetected?: boolean
  loginDetected?: boolean
  resultCount?: number
  useful?: boolean
  error?: string
}

export interface SearchProviderSnapshot {
  id: string
  label: string
  mode: BrowserMode
  kind: 'general' | 'onion'
  score: number
  uptime: number | null
  avgLatencyMs: number | null
  antiBotRate: number | null
  usefulnessRate: number | null
  degraded: boolean
  degradedUntil?: string
  attempts: number
  successes: number
  antiBotHits: number
  zeroResultHits: number
  lastError?: string
  lastUsedAt?: string
}

const SEARCH_DEGRADATION_COOLDOWN_MS = 3 * 60 * 1000

const PROVIDERS: readonly UwafSearchProvider[] = [
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    mode: 'direct',
    kind: 'general',
    priority: 90,
    resultsUrl: query => `https://duckduckgo.com/?q=${encodeURIComponent(query.trim())}&ia=web`,
    homeUrl: 'https://duckduckgo.com/',
    inputSelectors: ['input[name="q"]', 'textarea[name="q"]', 'input[type="text"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['[data-testid="result"]', '.result', '.results_links', '#links .result'],
  },
  {
    id: 'brave-search',
    label: 'Brave Search',
    mode: 'direct',
    kind: 'general',
    priority: 78,
    resultsUrl: query => `https://search.brave.com/search?q=${encodeURIComponent(query.trim())}&source=web`,
    homeUrl: 'https://search.brave.com/',
    inputSelectors: ['input[name="q"]', 'input[type="search"]', 'textarea[name="q"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.snippet', '.result', '[data-type="web"]', '.searchResult'],
  },
  {
    id: 'duckduckgo-lite',
    label: 'DuckDuckGo Lite',
    mode: 'stealth',
    kind: 'general',
    priority: 95,
    resultsUrl: query => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://lite.duckduckgo.com/lite/',
    inputSelectors: ['input[name="q"]', 'input[type="text"]'],
    submitSelectors: ['input[type="submit"]', 'button[type="submit"]'],
    resultSelectors: ['table a[href]', 'a.result-link', 'a[href^="http"]'],
    mirrors: ['https://duckduckgo.com/'],
  },
  {
    id: 'ahmia',
    label: 'Ahmia',
    mode: 'stealth',
    kind: 'onion',
    priority: 100,
    resultsUrl: query => `https://ahmia.fi/search/?q=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://ahmia.fi/',
    inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.searchResults li', '.search-results li', '.result', '.search-result', '.results li'],
  },
  {
    id: 'startpage',
    label: 'Startpage',
    mode: 'stealth',
    kind: 'general',
    priority: 82,
    resultsUrl: query => `https://www.startpage.com/sp/search?query=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://www.startpage.com/',
    inputSelectors: ['input[name="query"]', 'input[name="q"]', 'input[type="search"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.w-gl__result', '.result', 'a.result-link', '.main-result'],
  },
  {
    id: 'brave-search-stealth',
    label: 'Brave Search',
    mode: 'stealth',
    kind: 'general',
    priority: 68,
    resultsUrl: query => `https://search.brave.com/search?q=${encodeURIComponent(query.trim())}&source=web`,
    homeUrl: 'https://search.brave.com/',
    inputSelectors: ['input[name="q"]', 'input[type="search"]', 'textarea[name="q"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.snippet', '.result', '[data-type="web"]', '.searchResult'],
  },
] as const

const DEFAULT_CURATED_ENTRY_POINTS: readonly UwafCuratedEntryPoint[] = [
  {
    id: 'ahmia-home',
    label: 'Ahmia',
    url: 'https://ahmia.fi/',
    mode: 'stealth',
    tags: ['search', 'onion', 'directory'],
    source: 'built-in',
  },
  {
    id: 'duckduckgo-lite-home',
    label: 'DuckDuckGo Lite',
    url: 'https://lite.duckduckgo.com/lite/',
    mode: 'stealth',
    tags: ['search', 'general'],
    source: 'built-in',
  },
  {
    id: 'startpage-home',
    label: 'Startpage',
    url: 'https://www.startpage.com/',
    mode: 'stealth',
    tags: ['search', 'general'],
    source: 'built-in',
  },
] as const

const globalForUwafSearch = globalThis as typeof globalThis & {
  __peakuiUwafSearchState?: {
    providerState: Map<string, ProviderState>
  }
}

const searchState = globalForUwafSearch.__peakuiUwafSearchState ??= {
  providerState: new Map<string, ProviderState>(),
}

function ensureProviderState(id: string): ProviderState {
  const existing = searchState.providerState.get(id)
  if (existing) return existing

  const next: ProviderState = {
    attempts: 0,
    successes: 0,
    antiBotHits: 0,
    loginHits: 0,
    zeroResultHits: 0,
    usefulnessHits: 0,
    totalLatencyMs: 0,
    consecutiveFailures: 0,
  }
  searchState.providerState.set(id, next)
  return next
}

function parseEnvEntryPoints(): UwafCuratedEntryPoint[] {
  const raw = process.env.UWAF_STEALTH_ENTRYPOINTS_JSON?.trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return []
      const url = typeof entry.url === 'string' ? entry.url.trim() : ''
      const label = typeof entry.label === 'string' ? entry.label.trim() : ''
      if (!url || !label) return []
      const tags = Array.isArray((entry as { tags?: unknown }).tags)
        ? (entry as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim())
        : []
      return [{
        id: `env-${index}`,
        label,
        url,
        mode: 'stealth' as const,
        tags,
        source: 'env' as const,
      }]
    })
  } catch {
    return []
  }
}

function computeProviderScore(provider: UwafSearchProvider, state: ProviderState | undefined, query: string): number {
  const now = Date.now()
  const preferredOnion = /\.(onion)\b/i.test(query) || /\bonion\b|\bdark web\b|\bhidden service\b/i.test(query)
  const attempts = state?.attempts || 0
  const successRate = attempts > 0 ? (state?.successes || 0) / attempts : 0.8
  const antiBotRate = attempts > 0 ? (state?.antiBotHits || 0) / attempts : 0
  const usefulnessRate = attempts > 0 ? (state?.usefulnessHits || 0) / attempts : 0.6
  const avgLatency = attempts > 0 ? (state?.totalLatencyMs || 0) / attempts : 2500
  const degraded = Boolean(state?.degradedUntil && state.degradedUntil > now)

  let score = provider.priority
  score += successRate * 40
  score += usefulnessRate * 25
  score -= antiBotRate * 35
  score -= Math.min(avgLatency / 250, 20)
  if (preferredOnion && provider.kind === 'onion') score += 18
  if (!preferredOnion && provider.kind === 'onion') score -= 8
  if (degraded) score -= 60
  return Number(score.toFixed(2))
}

function getProvidersForMode(mode: BrowserMode): UwafSearchProvider[] {
  return PROVIDERS.filter(provider => provider.mode === mode)
}

export function getCuratedStealthEntryPoints(): UwafCuratedEntryPoint[] {
  return [...DEFAULT_CURATED_ENTRY_POINTS, ...parseEnvEntryPoints()]
}

export function listSearchProviders(mode: BrowserMode, query: string, profile?: StealthProfile): UwafSearchProvider[] {
  const profileProviderIds = mode === 'stealth' && profile
    ? new Set(
        profile === 'high'
          ? ['duckduckgo-lite', 'ahmia', 'startpage']
          : ['ahmia', 'duckduckgo-lite', 'startpage', 'brave-search-stealth'],
      )
    : null

  const providers = getProvidersForMode(mode)
    .filter(provider => !profileProviderIds || profileProviderIds.has(provider.id))
    .map(provider => ({
      provider,
      score: computeProviderScore(provider, searchState.providerState.get(provider.id), query),
    }))
    .sort((left, right) => right.score - left.score)
    .map(entry => entry.provider)

  return providers
}

export function recordSearchProviderOutcome(input: ProviderOutcome): void {
  const state = ensureProviderState(input.providerId)
  state.attempts += 1
  state.totalLatencyMs += Math.max(0, Math.round(input.durationMs))
  state.lastUsedAt = new Date().toISOString()

  if (input.success) {
    state.successes += 1
    state.consecutiveFailures = 0
    state.degradedUntil = undefined
    if (input.useful) state.usefulnessHits += 1
  } else {
    state.consecutiveFailures += 1
    state.lastError = input.error
    if (state.consecutiveFailures >= 2 || input.antiBotDetected || input.loginDetected) {
      state.degradedUntil = Date.now() + SEARCH_DEGRADATION_COOLDOWN_MS
    }
  }

  if (input.antiBotDetected) state.antiBotHits += 1
  if (input.loginDetected) state.loginHits += 1
  if ((input.resultCount || 0) === 0) state.zeroResultHits += 1
}

export function getSearchProviderSnapshot(mode?: BrowserMode): SearchProviderSnapshot[] {
  return PROVIDERS
    .filter(provider => !mode || provider.mode === mode)
    .map(provider => {
      const state = searchState.providerState.get(provider.id)
      const attempts = state?.attempts || 0
      const successes = state?.successes || 0
      const antiBotHits = state?.antiBotHits || 0
      const usefulnessHits = state?.usefulnessHits || 0
      const avgLatencyMs = attempts > 0 ? Math.round((state?.totalLatencyMs || 0) / attempts) : null
      const uptime = attempts > 0 ? Number((successes / attempts).toFixed(3)) : null
      const antiBotRate = attempts > 0 ? Number((antiBotHits / attempts).toFixed(3)) : null
      const usefulnessRate = attempts > 0 ? Number((usefulnessHits / attempts).toFixed(3)) : null
      return {
        id: provider.id,
        label: provider.label,
        mode: provider.mode,
        kind: provider.kind,
        score: computeProviderScore(provider, state, ''),
        uptime,
        avgLatencyMs,
        antiBotRate,
        usefulnessRate,
        degraded: Boolean(state?.degradedUntil && state.degradedUntil > Date.now()),
        degradedUntil: state?.degradedUntil ? new Date(state.degradedUntil).toISOString() : undefined,
        attempts,
        successes,
        antiBotHits,
        zeroResultHits: state?.zeroResultHits || 0,
        lastError: state?.lastError,
        lastUsedAt: state?.lastUsedAt,
      }
    })
    .sort((left, right) => right.score - left.score)
}

export function getPreferredSearchProviderLabel(mode: BrowserMode, query: string, profile?: StealthProfile): string {
  const [top] = listSearchProviders(mode, query, profile)
  return top?.label || (mode === 'stealth' ? 'Ahmia' : 'DuckDuckGo')
}
