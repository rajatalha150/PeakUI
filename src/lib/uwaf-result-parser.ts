/**
 * Pure parser for stealth-mode search result pages.
 *
 * Lives outside `uwaf-browser.ts` so the per-provider row extraction, URL
 * canonicalization, dedup, and category clustering can be unit-tested
 * without spinning up Playwright. The runtime (`executeSearch` in
 * `uwaf-browser.ts`) feeds each provider's `PageObservation` into
 * `parseSearchResults`, then runs the merged list through
 * `dedupeAndClusterResults`, and stamps the result onto
 * `UwafBrowserResult.clusteredResults`.
 *
 * Three guarantees the runtime relies on:
 *
 * 1. **Order is preserved** within a single provider's results (rank
 *    goes 1, 2, 3, ...). The cluster keeps intra-category rank order
 *    so the model sees the strongest matches first.
 *
 * 2. **URLs are canonicalized** before dedup. Two URLs that differ only
 *    in trailing slash, `www.` prefix, host case, or common tracking
 *    query params are treated as the same link. The canonical URL is
 *    what the model sees.
 *
 * 3. **Category is a hint, not a verdict.** It is computed by a small
 *    keyword-and-TLD heuristic. The model can override the cluster
 *    when it knows better; the humanizer and the markdown writer
 *    surface the cluster but do not gate on it.
 */

import type { UwafSearchProvider } from './uwaf-search-providers'

export type SearchResultCategory =
  | 'market'
  | 'forum'
  | 'link-list'
  | 'news'
  | 'service'
  | 'unknown'

export const ALL_CATEGORIES: readonly SearchResultCategory[] = [
  'market',
  'forum',
  'link-list',
  'news',
  'service',
  'unknown',
] as const

export interface ParsedSearchResult {
  /** Canonical URL (host lowercased, no trailing slash, no tracking params). */
  url: string
  /** Display title. Falls back to the URL's hostname if no title is on the row. */
  title: string
  /** Short snippet or description. May be empty if the provider did not render one. */
  snippet: string
  category: SearchResultCategory
  /** Id of the provider that surfaced this row. */
  providerId: string
  /** 1-based position within that provider's result list. */
  rank: number
}

export interface ClusteredResults {
  /** Results grouped by category, each list in rank order. */
  categories: Record<SearchResultCategory, ParsedSearchResult[]>
  /** Total unique results after dedup, sum of all category sizes. */
  total: number
  /** Categories that produced at least one result, in display order. */
  presentCategories: SearchResultCategory[]
}

export interface DedupStats {
  /** Sum of all input result rows across providers. */
  input: number
  /** Number of unique URLs that survived dedup. */
  unique: number
  /** input - unique. */
  dropped: number
}

/**
 * Minimal shape we need from a `PageObservation`. Defined inline so this
 * module does not depend on the Playwright-loaded `uwaf-browser.ts`
 * (which would create a circular import for the tests).
 */
export interface MinimalObservation {
  url: string
  title: string
  text: string
  html: string
  markdown: string
  links: Array<{ index: number; text: string; url: string }>
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'src',
])

/**
 * Canonicalize a URL for dedup: lowercase the host, strip the `www.`
 * prefix, drop the trailing slash, and drop common tracking query params.
 * Returns the input string if it is not a valid URL.
 */
export function canonicalizeUrl(input: string): string {
  if (!input || typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const port = url.port
      ? `:${url.port}`
      : ''
    const cleanPath = url.pathname.replace(/\/+$/, '') || '/'
    // Keep query params, but drop tracking ones. Preserve insertion order.
    const cleanedParams: string[] = []
    url.searchParams.forEach((value, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) return
      cleanedParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    })
    const query = cleanedParams.length > 0 ? `?${cleanedParams.join('&')}` : ''
    const hash = url.hash ? url.hash : ''
    return `${url.protocol}//${host}${port}${cleanPath}${query}${hash}`
  } catch {
    return trimmed
  }
}

/**
 * Heuristic category classifier. Combines keyword patterns over the
 * url + title + snippet, and adds extra weight to `.onion` host TLDs
 * commonly associated with markets.
 *
 * Deliberately conservative: returns 'unknown' for anything that does
 * not hit a clear signal. The cluster still groups unknowns at the end
 * so the model sees them; the humanizer never relies on the category
 * being correct.
 */
const CATEGORY_RULES: ReadonlyArray<{
  category: SearchResultCategory
  pattern: RegExp
}> = [
  { category: 'market', pattern: /\b(market|markets|shop|shops|vendor|vendors|cart|listing|listings|wholesale|storefront|pharmacy|pharmacies)\b/i },
  { category: 'market', pattern: /\/(market|shop|cart|store|product)\b/i },
  { category: 'forum', pattern: /\b(forum|forums|board|boards|community|communities|thread|threads|topic|topics|subforum)\b/i },
  { category: 'forum', pattern: /(\/threads\/|\/viewtopic|\/forums\/|\/community\/|\/board\/)/i },
  { category: 'link-list', pattern: /\b(directory|directories|wiki|wikis|links?|list of onion|link list|onion list)\b/i },
  { category: 'link-list', pattern: /\/wiki\/|\/directory\//i },
  { category: 'news', pattern: /\b(news|daily|today|leak|leaks|leaked|breach|breaches|journalist|journalists|whistleblower|whistleblowers|press freedom|war crimes|investigation|investigations|press)\b/i },
  { category: 'news', pattern: /\b(20\d{2}|19\d{2})\b/ },
  { category: 'service', pattern: /\b(hosting|vpn|email|paste|pastes|pastebin|proxy|proxies|checker|checkers|generator|generators|scanner|scanners|search engine|search engines)\b/i },
]

export function classifyResult(input: {
  url: string
  title: string
  snippet?: string
}): SearchResultCategory {
  const haystack = `${input.url} ${input.title} ${input.snippet || ''}`
  for (const { category, pattern } of CATEGORY_RULES) {
    if (pattern.test(haystack)) return category
  }
  return 'unknown'
}

interface ParsedRow {
  url: string
  title: string
  snippet: string
}

/**
 * Pull a URL from an `<a>` element. Used by every per-provider parser.
 * The text becomes the title; if the title is empty we fall back to
 * the URL's hostname so the result row is never blank.
 */
function rowFromAnchor(anchorText: string, href: string): ParsedRow | null {
  if (!href || !href.trim()) return null
  let title = (anchorText || '').replace(/\s+/g, ' ').trim()
  if (!title) {
    try {
      title = new URL(href).hostname
    } catch {
      title = href
    }
  }
  return { url: href, title, snippet: '' }
}

/**
 * Extract a snippet for a given anchor from a small window of the page
 * markdown. We pick the line that contains the anchor's URL (after
 * canonicalization) and use the next 1-2 lines as the snippet.
 *
 * This is a best-effort recovery — the providers that render snippets
 * in their own row divs (`<p>`, `<span>`, etc.) may produce a different
 * or empty snippet. The classifier does not depend on snippets.
 */
function snippetForAnchor(anchor: ParsedRow, observation: MinimalObservation): string {
  const canonical = canonicalizeUrl(anchor.url)
  if (!observation.markdown) return ''
  const lines = observation.markdown.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    if (line.includes(canonical) || line.includes(anchor.url)) {
      const next = lines[i + 1]?.trim() || ''
      const combined = [line.trim(), next].filter(Boolean).join(' — ')
      return combined.slice(0, 240)
    }
  }
  return ''
}

/**
 * Parsers keyed by provider id. Each one is a small function that walks
 * the observation's link list (which `extractLinksFromPage` already
 * produced) and pulls the title/snippet per row.
 *
 * Why no DOM parsing? `extractLinksFromPage` (in `uwaf-browser.ts`)
 * already runs the page through a sanitizer and extracts every
 * `<a href>` with non-empty text. Re-walking the HTML here would
 * duplicate that work and re-introduce a hard dependency on the
 * Playwright-loaded module. The link list is enough.
 */
type ProviderParser = (observation: MinimalObservation) => ParsedRow[]

function passthroughParser(observation: MinimalObservation): ParsedRow[] {
  const seen = new Set<string>()
  const rows: ParsedRow[] = []
  for (const link of observation.links) {
    const row = rowFromAnchor(link.text, link.url)
    if (!row) continue
    if (seen.has(row.url)) continue
    seen.add(row.url)
    rows.push(row)
  }
  return rows
}

/**
 * Ahmia: result rows are `<li>` with one anchor and a small description
 * `<p>`. The link extractor already returns the anchor; we just need to
 * skip the site's own internal navigation (search, login, home).
 */
const AHMIA_HOST = /^https?:\/\/(?:www\.)?ahmia\.fi\//i
const AHMIA_NAV_PATH = /\/(about|help|stats|submit|add|catalog|browse|filters|api)\b/i

function ahmiaParser(observation: MinimalObservation): ParsedRow[] {
  return passthroughParser(observation).filter(row => {
    if (AHMIA_HOST.test(row.url)) {
      // Drop Ahmia's own chrome (home, about, submit, etc.).
      const path = (() => {
        try {
          return new URL(row.url).pathname
        } catch {
          return row.url
        }
      })()
      if (path === '/' || path === '') return false
      if (AHMIA_NAV_PATH.test(path)) return false
    }
    return true
  })
}

/**
 * OnionWay: result cards have a title link and a snippet block. We
 * detect a row link by excluding the site's chrome (home, login, nav).
 */
const ONIONWAY_NAV_HREFS = /^https?:\/\/(?:www\.)?onionway\.com\/(?!search\.php\?)/i

function onionwayParser(observation: MinimalObservation): ParsedRow[] {
  return passthroughParser(observation).filter(row => !ONIONWAY_NAV_HREFS.test(row.url))
}

/**
 * OnionLand and TorDex share a result-block structure: anchor with
 * title plus a description `<p>`. Same exclusion pattern — drop
 * site chrome.
 */
const ONIONLAND_HOST = /^https?:\/\/(?:www\.)?onionland\.to\//i
const TORDEX_HOST = /^https?:\/\/(?:www\.)?tordex\.app\//i

function onionlandParser(observation: MinimalObservation): ParsedRow[] {
  return passthroughParser(observation).filter(row => !ONIONLAND_HOST.test(row.url))
}

function tordexParser(observation: MinimalObservation): ParsedRow[] {
  return passthroughParser(observation).filter(row => !TORDEX_HOST.test(row.url))
}

/**
 * Excavator: results are blog-style posts. Drop nav/footer/feed links.
 */
const EXCAVATOR_NAV_HREFS = /^https?:\/\/(?:www\.)?excavatorsearchengine\.com\/(?!\?s=)/i

function excavatorParser(observation: MinimalObservation): ParsedRow[] {
  return passthroughParser(observation).filter(row => !EXCAVATOR_NAV_HREFS.test(row.url))
}

const PARSERS: Readonly<Record<string, ProviderParser>> = {
  ahmia: ahmiaParser,
  onionway: onionwayParser,
  onionland: onionlandParser,
  tordex: tordexParser,
  excavator: excavatorParser,
}

/**
 * Parse the search result rows out of one provider's observation.
 * Returns a `ParsedSearchResult[]` with rank = position in the row list.
 */
export function parseSearchResults(
  observation: MinimalObservation,
  provider: UwafSearchProvider,
  query: string,
): ParsedSearchResult[] {
  const parser = PARSERS[provider.id] ?? passthroughParser
  const rows = parser(observation)
  const results: ParsedSearchResult[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row) continue
    const snippet = row.snippet || snippetForAnchor(row, observation) || query
    results.push({
      url: canonicalizeUrl(row.url),
      title: row.title,
      snippet,
      category: classifyResult({ url: row.url, title: row.title, snippet }),
      providerId: provider.id,
      rank: i + 1,
    })
  }
  return results
}

/**
 * Dedup by canonical URL, keeping the highest-rank + longest-snippet
 * copy. Inputs are assumed to be already parseSearchResults-shaped
 * (canonical URLs, ranks 1..N).
 *
 * Sort key: lower rank wins; ties broken by longer snippet. The
 * composite key below inverts the snippet length so that a strictly
 * greater score means "better" — a lower rank is a smaller multiplier,
 * and a longer snippet subtracts more, so the score is smaller for the
 * preferred row in both axes.
 */
export function dedupeResults(
  resultLists: ParsedSearchResult[][],
): { results: ParsedSearchResult[]; stats: DedupStats } {
  const input = resultLists.reduce((sum, list) => sum + list.length, 0)
  const byUrl = new Map<string, ParsedSearchResult>()
  for (const list of resultLists) {
    for (const result of list) {
      const existing = byUrl.get(result.url)
      if (!existing) {
        byUrl.set(result.url, result)
        continue
      }
      // Lower score wins. rank is a small positive integer; length is
      // unbounded. We weight rank high so it dominates ties.
      const existingScore = existing.rank * 10_000 - existing.snippet.length
      const newScore = result.rank * 10_000 - result.snippet.length
      if (newScore < existingScore) {
        byUrl.set(result.url, result)
      }
    }
  }
  const unique = Array.from(byUrl.values()).sort((a, b) => a.rank - b.rank)
  return {
    results: unique,
    stats: { input, unique: unique.length, dropped: input - unique.length },
  }
}

/**
 * Group deduped results by category, preserving rank order within each
 * category, and order the categories so the most "useful" ones come
 * first for the model.
 */
const CATEGORY_DISPLAY_ORDER: readonly SearchResultCategory[] = [
  'market',
  'forum',
  'news',
  'link-list',
  'service',
  'unknown',
] as const

export function clusterResults(results: ParsedSearchResult[]): ClusteredResults {
  const grouped: Record<SearchResultCategory, ParsedSearchResult[]> = {
    market: [],
    forum: [],
    'link-list': [],
    news: [],
    service: [],
    unknown: [],
  }
  for (const result of results) {
    grouped[result.category].push(result)
  }
  for (const category of ALL_CATEGORIES) {
    grouped[category].sort((a, b) => a.rank - b.rank)
  }
  const presentCategories = CATEGORY_DISPLAY_ORDER.filter(
    category => grouped[category].length > 0,
  )
  return {
    categories: grouped,
    total: results.length,
    presentCategories,
  }
}

/**
 * Convenience: run parseSearchResults for each provider's observation,
 * then dedupe and cluster. `observations` is keyed by provider id.
 */
export function dedupeAndClusterResults(
  observations: ReadonlyArray<{
    provider: UwafSearchProvider
    observation: MinimalObservation
    query: string
  }>,
): { results: ParsedSearchResult[]; cluster: ClusteredResults; dedupStats: DedupStats } {
  const lists = observations.map(({ provider, observation, query }) =>
    parseSearchResults(observation, provider, query),
  )
  const dedup = dedupeResults(lists)
  const cluster = clusterResults(dedup.results)
  return { results: dedup.results, cluster, dedupStats: dedup.stats }
}

export const __test__ = {
  canonicalizeUrl,
  classifyResult,
  CATEGORY_RULES,
  TRACKING_PARAMS,
  PARSERS,
}
