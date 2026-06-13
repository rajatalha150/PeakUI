import type { BrowserMode } from './uwaf-pool'
import { getStealthProfileDefinition, type StealthProfile } from './uwaf-fingerprint'

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

export interface UwafSearchAttempt {
  providerId: string
  providerLabel: string
  success: boolean
  resultCount: number
  queryMatched?: boolean
  failureCode?: string
  failureDetail?: string
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

function envUrl(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && /^https?:\/\//i.test(value) ? value : undefined
}

function appendSearchPath(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const trimmedPath = path.replace(/^\/+/, '')
  return `${trimmedBase}/${trimmedPath}`
}

function createEnvBackedProvider(options: {
  id: string
  label: string
  mode: BrowserMode
  kind: 'general' | 'onion'
  priority: number
  envPrefix: string
  defaultSearchPath?: string
  defaultQueryParam?: string
  inputSelectors: string[]
  submitSelectors: string[]
  resultSelectors: string[]
  mirrors?: string[]
}): UwafSearchProvider | null {
  const homeUrl = envUrl(`UWAF_STEALTH_PROVIDER_${options.envPrefix}_HOME_URL`)
  if (!homeUrl) return null

  const queryUrlTemplate = process.env[`UWAF_STEALTH_PROVIDER_${options.envPrefix}_QUERY_URL`]?.trim()
  const resultsUrl = (query: string) => {
    const encoded = encodeURIComponent(query.trim())
    if (queryUrlTemplate) {
      return queryUrlTemplate.includes('{query}')
        ? queryUrlTemplate.replace(/\{query\}/g, encoded)
        : `${queryUrlTemplate}${encoded}`
    }
    const queryParam = options.defaultQueryParam || 'q'
    const searchUrl = appendSearchPath(homeUrl, options.defaultSearchPath || 'search')
    const separator = searchUrl.includes('?') ? '&' : '?'
    return `${searchUrl}${separator}${queryParam}=${encoded}`
  }

  return {
    id: options.id,
    label: options.label,
    mode: options.mode,
    kind: options.kind,
    priority: options.priority,
    resultsUrl,
    homeUrl,
    inputSelectors: options.inputSelectors,
    submitSelectors: options.submitSelectors,
    resultSelectors: options.resultSelectors,
    mirrors: options.mirrors,
  }
}

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
    id: 'onionway',
    label: 'OnionWay',
    mode: 'stealth',
    kind: 'onion',
    priority: 96,
    resultsUrl: query => `https://onionway.com/search.php?s=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://onionway.com/',
    inputSelectors: ['input[name="s"]', 'input[type="search"]', 'input[type="text"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.search_results .s_result', '.search_results .card', '.search_results .title a', '.search_results a[href]'],
  },
  {
    id: 'onionland',
    label: 'OnionLand',
    mode: 'stealth',
    kind: 'onion',
    priority: 93,
    resultsUrl: query => `https://www.onionland.to/search?q=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://www.onionland.to/',
    inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.search-results .result-block', '.search-results .result', '.search-results a[href]', '.tbb-results .result-block'],
  },
  {
    id: 'tordex',
    label: 'TorDex',
    mode: 'stealth',
    kind: 'onion',
    priority: 91,
    resultsUrl: query => `https://tordex.app/search?q=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://tordex.app/',
    inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['.search-results .result-block', '.search-results .result', '.search-results a[href]', '.tbb-results .result-block'],
  },
  {
    id: 'excavator',
    label: 'Excavator',
    mode: 'stealth',
    kind: 'onion',
    priority: 74,
    resultsUrl: query => `https://excavatorsearchengine.com/?s=${encodeURIComponent(query.trim())}`,
    homeUrl: 'https://excavatorsearchengine.com/',
    inputSelectors: ['input[name="s"]', 'input[type="search"]', 'input[type="text"]'],
    submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
    resultSelectors: ['article', '.search-results article', '.entry-title a', '.post', 'main a[href]'],
  },
  ...[
    createEnvBackedProvider({
      id: 'tor66',
      label: 'Tor66',
      mode: 'stealth',
      kind: 'onion',
      priority: 84,
      envPrefix: 'TOR66',
      defaultSearchPath: 'search',
      defaultQueryParam: 'q',
      inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
      submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
      resultSelectors: ['.search-results .result', '.result', 'a[href]'],
    }),
    createEnvBackedProvider({
      id: 'torch',
      label: 'Torch',
      mode: 'stealth',
      kind: 'onion',
      priority: 83,
      envPrefix: 'TORCH',
      defaultSearchPath: 'search',
      defaultQueryParam: 'q',
      inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
      submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
      resultSelectors: ['.search-results .result', '.result', 'a[href]'],
    }),
    createEnvBackedProvider({
      id: 'our-realm',
      label: 'Our Realm',
      mode: 'stealth',
      kind: 'onion',
      priority: 79,
      envPrefix: 'OUR_REALM',
      defaultSearchPath: 'search',
      defaultQueryParam: 'q',
      inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
      submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
      resultSelectors: ['.search-results .result', '.result', 'a[href]'],
    }),
    createEnvBackedProvider({
      id: 'torch-by-tordex',
      label: 'Torch by TorDex',
      mode: 'stealth',
      kind: 'onion',
      priority: 78,
      envPrefix: 'TORCH_BY_TORDEX',
      defaultSearchPath: 'search',
      defaultQueryParam: 'q',
      inputSelectors: ['input[name="q"]', 'input[type="search"]', 'input[type="text"]'],
      submitSelectors: ['button[type="submit"]', 'input[type="submit"]'],
      resultSelectors: ['.search-results .result', '.result', 'a[href]'],
    }),
  ].filter((provider): provider is UwafSearchProvider => Boolean(provider)),
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
    id: 'onionway-home',
    label: 'OnionWay',
    url: 'https://onionway.com/',
    mode: 'stealth',
    tags: ['search', 'onion', 'directory'],
    source: 'built-in',
  },
  {
    id: 'onionland-home',
    label: 'OnionLand',
    url: 'https://www.onionland.to/',
    mode: 'stealth',
    tags: ['search', 'onion', 'directory'],
    source: 'built-in',
  },
  {
    id: 'tordex-home',
    label: 'TorDex',
    url: 'https://tordex.app/',
    mode: 'stealth',
    tags: ['search', 'onion', 'directory'],
    source: 'built-in',
  },
  {
    id: 'excavator-home',
    label: 'Excavator',
    url: 'https://excavatorsearchengine.com/',
    mode: 'stealth',
    tags: ['search', 'onion', 'directory'],
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
  score += successRate * 55
  score += usefulnessRate * 32
  score -= antiBotRate * 45
  score -= Math.min(avgLatency / 160, 32)
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

export function listSearchProviders(
  mode: BrowserMode,
  query: string,
  profile?: StealthProfile,
  preferredProviderId?: string,
): UwafSearchProvider[] {
  const allowedProviderIds = mode === 'stealth' && profile
    ? new Set(getStealthProfileDefinition(profile).providerIds)
    : null

  const providers = getProvidersForMode(mode)
    .filter(provider => !allowedProviderIds || allowedProviderIds.has(provider.id))
    .map(provider => ({
      provider,
      score: computeProviderScore(provider, searchState.providerState.get(provider.id), query),
    }))
    .sort((left, right) => right.score - left.score)
    .map(entry => entry.provider)

  if (!preferredProviderId) return providers
  const exact = providers.find(provider => provider.id === preferredProviderId)
  if (!exact) return providers
  return [exact, ...providers.filter(provider => provider.id !== preferredProviderId)]
}

export function getSearchProviderById(mode: BrowserMode, providerId: string): UwafSearchProvider | undefined {
  return getProvidersForMode(mode).find(provider => provider.id === providerId)
}

export function getSearchProviderLabel(providerId: string): string | undefined {
  return PROVIDERS.find(provider => provider.id === providerId)?.label
}

export function getStealthProviderLabels(profile?: StealthProfile): string[] {
  return listSearchProviders('stealth', '', profile).map(provider => provider.label)
}

export function getStealthProviderIds(profile?: StealthProfile): string[] {
  return listSearchProviders('stealth', '', profile).map(provider => provider.id)
}

export function getStealthProviderCatalog(): Array<{ id: string; label: string; active: boolean }> {
  const activeIds = new Set(getProvidersForMode('stealth').map(provider => provider.id))
  const catalog = [
    { id: 'onionway', label: 'OnionWay' },
    { id: 'tor66', label: 'Tor66' },
    { id: 'ahmia', label: 'Ahmia' },
    { id: 'onionland', label: 'OnionLand' },
    { id: 'torch', label: 'Torch' },
    { id: 'tordex', label: 'TorDex' },
    { id: 'our-realm', label: 'Our Realm' },
    { id: 'torch-by-tordex', label: 'Torch by TorDex' },
    { id: 'excavator', label: 'Excavator' },
  ]

  return catalog.map(entry => ({
    ...entry,
    active: activeIds.has(entry.id),
  }))
}

export function getPreferredStealthProviderId(query: string, profile?: StealthProfile): string | undefined {
  const [top] = listSearchProviders('stealth', query, profile)
  return top?.id
}

export function isStealthProviderId(value: string): boolean {
  return getStealthProviderCatalog().some(entry => entry.id === value)
}

export function summarizeSearchAttempts(attempts: readonly UwafSearchAttempt[]): string[] {
  return attempts.map(attempt => {
    const outcome = attempt.success
      ? `success (${attempt.resultCount} result blocks)`
      : `failed${attempt.failureCode ? `: ${attempt.failureCode}` : ''}${attempt.resultCount > 0 ? ` (${attempt.resultCount} result blocks)` : ''}`
    return `${attempt.providerLabel}: ${outcome}`
  })
}

export function listSearchProvidersForPrompt(mode: BrowserMode, profile?: StealthProfile): string {
  return listSearchProviders(mode, '', profile)
    .map(provider => provider.label)
    .join(', ')
}

export function getPreferredSearchProviderLabelForPrompt(profile?: StealthProfile): string {
  return getPreferredSearchProviderLabel('stealth', '', profile)
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
