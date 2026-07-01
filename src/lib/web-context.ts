import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { mergeMessageSources, type MessageSource } from './message-sources'

const SEARCH_TIMEOUT_MS = 8000
const FETCH_TIMEOUT_MS = 10000
const FETCH_RETRY_DELAY_MS = 800
const MAX_SEARCH_RESULTS = 8
const MAX_FETCHED_PAGES = 4
const MAX_RESPONSE_BYTES = 500_000
const MAX_SOURCE_EXCERPT_CHARS = 3000
const MAX_CONTEXT_CHARS = 12_000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const BRAVE_API_KEY = process.env.BRAVE_API_KEY?.trim() || ''
const SEARXNG_URL = process.env.SEARXNG_URL?.trim() || ''
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY?.trim() || ''
const GOOGLE_SEARCH_CX = process.env.GOOGLE_SEARCH_CX?.trim() || ''

export interface PublicWebSearchResult {
  title: string
  url: string
  snippet: string
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 1).trimEnd()}…`
}

function withTimeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function extractUrlsFromText(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>"')]+/gi) ?? []
  return matches
    .map(match => match.replace(/[),.;!?]+$/, ''))
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .slice(0, MAX_FETCHED_PAGES)
}

/* ───────── Query intelligence ───────── */

const CURRENT_YEAR = new Date().getFullYear()

export function generateSearchQueries(userQuery: string): string[] {
  const clean = userQuery.trim()
  if (!clean) return []

  const queries: string[] = [clean]

  // If it's a comparison, also search each side individually
  const comparisonMatch = clean.match(/\b(vs\.?|versus|compared? to|or|and)\b/i)
  if (comparisonMatch) {
    const parts = clean.split(/\b(?:vs\.?|versus|compared? to|or|and)\b/i)
    if (parts.length === 2) {
      const left = parts[0].trim().replace(/^(?:what is|who is|how does|compare|difference between)\s+/i, '').trim()
      const right = parts[1].trim()
      if (left && right) {
        queries.push(`${left} overview ${CURRENT_YEAR}`)
        queries.push(`${right} overview ${CURRENT_YEAR}`)
      }
    }
  }

  // Strip question prefixes to create a focused keyword query
  const stripped = clean
    .replace(/^(?:what is|who is|how (?:to|do|can|does)|why is|when is|where is|latest|current|recent|show me|find|search for|look up|tell me about)\s+/i, '')
    .replace(/\?/g, '')
    .trim()

  if (stripped && stripped !== clean && stripped.length > 3) {
    // Add year context for time-sensitive topics if not already present
    const yearRegex = /\b(20\d{2})\b/
    if (!yearRegex.test(stripped) && !yearRegex.test(clean)) {
      queries.push(`${stripped} ${CURRENT_YEAR}`)
    } else {
      queries.push(stripped)
    }
  }

  // For product/recommendation queries, add a "review" or "best" variant
  const productSignals = /\b(best|top|recommend|cheap|budget|review|compare|vs|versus|buy|under\s*\$|under\s*\d)/i
  if (productSignals.test(clean)) {
    const productTerms = clean
      .replace(/^(?:what (?:is|are)|show me|find|search for|look up|tell me about|can you|please|I (?:want|need|am looking for))\s+/i, '')
      .replace(/\?/g, '')
      .trim()
    if (productTerms.length > 5 && productTerms !== clean) {
      queries.push(`${productTerms} review ${CURRENT_YEAR}`)
    }
  }

  return queries.filter((q, i, arr) => arr.indexOf(q) === i).slice(0, 3)
}

/* ───────── URL safety ───────── */

function isBlockedIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true

  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  )
}

async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Blocked non-web URL: ${url.href}`)
  }

  if (url.username || url.password) {
    throw new Error(`Blocked credentialed URL: ${url.href}`)
  }

  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error(`Blocked non-standard port for URL: ${url.href}`)
  }

  const hostname = url.hostname.toLowerCase()
  const allowInternalHosts = process.env.PEAKUI_ALLOW_INTERNAL_HOSTS === 'true'
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    (hostname.endsWith('.internal') && !allowInternalHosts)
  ) {
    throw new Error(`Blocked local/private URL: ${url.href}`)
  }

  const directIp = isIP(hostname)
  if (directIp === 4 && isBlockedIpv4(hostname)) {
    throw new Error(`Blocked private IPv4 URL: ${url.href}`)
  }
  if (directIp === 6 && isBlockedIpv6(hostname)) {
    throw new Error(`Blocked private IPv6 URL: ${url.href}`)
  }

  if (!directIp) {
    const resolved = await lookup(hostname, { all: true })
    if (resolved.length === 0) {
      throw new Error(`Could not resolve URL host: ${url.href}`)
    }

    const hasPrivateAddress = resolved.some(entry => (
      entry.family === 4
        ? isBlockedIpv4(entry.address)
        : isBlockedIpv6(entry.address)
    ))

    if (hasPrivateAddress) {
      throw new Error(`Blocked URL that resolves to private address: ${url.href}`)
    }
  }

  return url
}

/* ───────── Search engines ───────── */

function decodeDuckDuckGoRedirectUrl(rawHref: string): string | null {
  const decodedHref = decodeHtmlEntities(rawHref)
  const normalizedHref = decodedHref.startsWith('//')
    ? `https:${decodedHref}`
    : decodedHref.startsWith('/')
      ? `https://duckduckgo.com${decodedHref}`
      : decodedHref

  try {
    const url = new URL(normalizedHref)
    const target = url.searchParams.get('uddg')
    if (target) return target
    if (url.hostname && url.hostname !== 'duckduckgo.com') return url.toString()
  } catch {
    return null
  }

  return null
}

function decodeBingRedirectUrl(rawHref: string): string | null {
  const decodedHref = decodeHtmlEntities(rawHref)

  try {
    const url = new URL(decodedHref)
    const encodedTarget = url.searchParams.get('u')
    if (!encodedTarget) return decodedHref

    const payload = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget
    return Buffer.from(payload, 'base64').toString('utf8')
  } catch {
    return null
  }
}

async function searchBrave(query: string, maxResults: number, signal?: AbortSignal): Promise<PublicWebSearchResult[]> {
  if (!BRAVE_API_KEY) return []

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(maxResults, 10)))
  url.searchParams.set('offset', '0')
  url.searchParams.set('text_decorations', 'false')

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
    signal: withTimeoutSignal(SEARCH_TIMEOUT_MS, signal),
  })

  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status}`)
  }

  const data = await response.json()
  const results = Array.isArray(data?.web?.results) ? data.web.results : []

  return results.slice(0, maxResults).map((item: { title?: string; url?: string; description?: string }) => ({
    title: String(item.title || ''),
    url: String(item.url || ''),
    snippet: String(item.description || ''),
  })).filter((r: PublicWebSearchResult) => r.url && r.title)
}

async function searchSearxng(query: string, maxResults: number, signal?: AbortSignal): Promise<PublicWebSearchResult[]> {
  if (!SEARXNG_URL) return []

  const url = new URL(`${SEARXNG_URL.replace(/\/$/, '')}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('engines', 'google,bing,duckduckgo,wikipedia')

  const response = await fetch(url.toString(), {
    signal: withTimeoutSignal(SEARCH_TIMEOUT_MS, signal),
  })

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status}`)
  }

  const data = await response.json()
  const results = Array.isArray(data?.results) ? data.results : []

  return results.slice(0, maxResults).map((item: { title?: string; url?: string; content?: string; snippet?: string }) => ({
    title: String(item.title || ''),
    url: String(item.url || ''),
    snippet: String(item.content || item.snippet || ''),
  })).filter((r: PublicWebSearchResult) => r.url && r.title)
}

async function searchDuckDuckGo(query: string, maxResults: number, signal?: AbortSignal): Promise<PublicWebSearchResult[]> {
  const encoded = encodeURIComponent(query)
  const urlsToTry = [
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://lite.duckduckgo.com/lite/?q=${encoded}`,
  ]

  let lastError: Error | undefined

  for (const searchUrl of urlsToTry) {
    try {
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: withTimeoutSignal(SEARCH_TIMEOUT_MS, signal),
      })

      if (!response.ok) {
        lastError = new Error(`DuckDuckGo ${response.status}`)
        continue
      }

      const html = await response.text()
      const results: PublicWebSearchResult[] = []

      // Try standard HTML DuckDuckGo selectors
      const resultBlocks = html.match(/<div class="result[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div class="result|<div class="no-results)/g) || []

      for (const block of resultBlocks.slice(0, maxResults)) {
        const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/)
        const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)

        if (titleMatch && snippetMatch) {
          const rawHref = block.match(/<a[^>]+href="([^"]+)"[^>]*class="result__a"/)?.[1] || ''
          const url = decodeDuckDuckGoRedirectUrl(rawHref)
          if (url) {
            results.push({
              title: stripTags(titleMatch[1]),
              url,
              snippet: stripTags(snippetMatch[1]),
            })
          }
        }
      }

      // Fallback: try lite version selectors
      if (results.length === 0) {
        const liteRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []
        for (const row of liteRows) {
          const linkMatch = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
          if (linkMatch) {
            const url = decodeDuckDuckGoRedirectUrl(linkMatch[1])
            const title = stripTags(linkMatch[2])
            const snippet = stripTags(row.replace(/<a[^>]*>[\s\S]*?<\/a>/g, ''))
            if (url && title) {
              results.push({ title, url, snippet })
            }
          }
        }
      }

      if (results.length > 0) return results.slice(0, maxResults)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError || new Error('DuckDuckGo search failed')
}

async function searchBing(query: string, maxResults: number, signal?: AbortSignal): Promise<PublicWebSearchResult[]> {
  const encoded = encodeURIComponent(query)
  const response = await fetch(`https://www.bing.com/search?q=${encoded}&count=${maxResults}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: withTimeoutSignal(SEARCH_TIMEOUT_MS, signal),
  })

  if (!response.ok) {
    throw new Error(`Bing search failed: ${response.status}`)
  }

  const html = await response.text()
  const results: PublicWebSearchResult[] = []

  // Try multiple Bing result selectors
  const selectors = [
    /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g,
    /<div class="b_algo"[^>]*>([\s\S]*?)<\/div>/g,
  ]

  for (const regex of selectors) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null && results.length < maxResults) {
      const block = match[1]
      const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)
      const linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)

      if (titleMatch && linkMatch) {
        const rawHref = linkMatch[1]
        const url = decodeBingRedirectUrl(rawHref) || rawHref
        const title = stripTags(titleMatch[1])
        const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''

        if (url && title) {
          results.push({ title, url, snippet })
        }
      }
    }

    if (results.length > 0) break
  }

  if (results.length === 0) {
    throw new Error('Bing search returned no parseable results')
  }

  return results.slice(0, maxResults)
}

async function searchGoogle(query: string, maxResults: number, signal?: AbortSignal): Promise<PublicWebSearchResult[]> {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_CX) return []

  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('q', query)
  url.searchParams.set('key', GOOGLE_SEARCH_API_KEY)
  url.searchParams.set('cx', GOOGLE_SEARCH_CX)
  url.searchParams.set('num', String(Math.min(maxResults, 10)))

  const response = await fetch(url.toString(), {
    signal: withTimeoutSignal(SEARCH_TIMEOUT_MS, signal),
  })

  if (!response.ok) {
    throw new Error(`Google search failed: ${response.status}`)
  }

  const data = await response.json()
  const items = Array.isArray(data?.items) ? data.items : []

  return items.slice(0, maxResults).map((item: { title?: string; link?: string; snippet?: string }) => ({
    title: String(item.title || ''),
    url: String(item.link || ''),
    snippet: String(item.snippet || ''),
  })).filter((r: PublicWebSearchResult) => r.url && r.title)
}

/* ───────── Content extraction ───────── */

function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = []
  const regex = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (Array.isArray(parsed)) {
        results.push(...parsed)
      } else if (parsed && typeof parsed === 'object') {
        results.push(parsed)
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return results
}

function extractOpenGraph(html: string): Record<string, string> {
  const og: Record<string, string> = {}
  const regex = /<meta[^>]+property="og:([^"]+)"[^>]+content="([^"]*)"[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    og[match[1]] = decodeHtmlEntities(match[2])
  }
  return og
}

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {}
  const regex = /<meta[^>]+name="([^"]+)"[^>]+content="([^"]*)"[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    meta[match[1].toLowerCase()] = decodeHtmlEntities(match[2])
  }
  return meta
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return titleMatch ? stripTags(titleMatch[1]) : ''
}

function extractDateFromMeta(html: string): string | null {
  const meta = extractMetaTags(html)
  const candidates = [
    meta['article:published_time'],
    meta['publisheddate'],
    meta['publishdate'],
    meta['datepublished'],
    meta['date'],
    meta['creation_date'],
  ]
  for (const c of candidates) {
    if (c) return c.trim()
  }

  // Try JSON-LD
  const ld = extractJsonLd(html)
  for (const item of ld) {
    if (typeof item.datePublished === 'string') return item.datePublished
    if (typeof item.dateModified === 'string') return item.dateModified
    if (Array.isArray(item.author)) {
      // Some nested schemas
    }
  }

  return null
}

function extractSiteName(html: string, url: URL): string {
  const og = extractOpenGraph(html)
  if (og.site_name) return og.site_name

  const hostname = url.hostname.replace(/^www\./, '')
  const parts = hostname.split('.')
  if (parts.length >= 2) {
    return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1)
  }
  return hostname
}

interface ExtractedPage {
  title: string
  description: string
  text: string
  datePublished: string | null
  author: string | null
  siteName: string
}

function scoreParagraph(text: string): number {
  const t = text.trim()
  if (t.length < 40) return -10
  const words = t.split(/\s+/).length
  const commas = (t.match(/,/g) || []).length
  const links = (t.match(/https?:\/\//g) || []).length
  const linkDensity = links / Math.max(words, 1)
  let score = words * 0.5 + commas * 2
  if (linkDensity > 0.3) score *= 0.3
  if (/\b(copyright|all rights reserved|privacy policy|terms of use|cookie policy|advertisement|sponsored)\b/i.test(t)) score -= 30
  if (/\b(click here|read more|learn more|sign up|subscribe|download now)\b/i.test(t)) score -= 20
  if (/^[A-Z][^a-z]{2,}$/.test(t.split(/\s+/)[0] || '')) score += 5 // likely heading
  return score
}

function extractReadableText(html: string, url: URL): ExtractedPage {
  const og = extractOpenGraph(html)
  const meta = extractMetaTags(html)
  const jsonLd = extractJsonLd(html)

  // Try to get article body from JSON-LD
  let articleBody = ''
  for (const item of jsonLd) {
    if (typeof item.articleBody === 'string' && item.articleBody.length > 200) {
      articleBody = item.articleBody
      break
    }
    if (typeof item.text === 'string' && item.text.length > 200) {
      articleBody = item.text
      break
    }
  }

  const title = og.title || meta['twitter:title'] || extractTitle(html) || url.hostname
  const description = og.description || meta['twitter:description'] || meta.description || ''
  const datePublished = extractDateFromMeta(html)
  let author: string | null = null

  for (const item of jsonLd) {
    if (typeof item.author === 'string') author = item.author
    else if (item.author && typeof item.author === 'object' && item.author !== null && 'name' in item.author && typeof (item.author as Record<string, unknown>).name === 'string') author = (item.author as Record<string, unknown>).name as string
  }

  if (articleBody) {
    return {
      title: stripTags(title),
      description: stripTags(description),
      text: normalizeWhitespace(articleBody),
      datePublished,
      author,
      siteName: extractSiteName(html, url),
    }
  }

  // Remove script/style/noscript/iframe/nav/footer/aside tags entirely
  const cleaned = html
    .replace(/<(script|style|noscript|iframe|nav|footer|aside|header|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(div|span|section|article|main)[^>]*>/gi, '\n')

  // Try to find the main content area
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  const targetHtml = mainMatch?.[1] || articleMatch?.[1] || cleaned

  // Split into paragraphs
  const paragraphs = targetHtml
    .split(/\n+/)
    .map(p => stripTags(p).trim())
    .filter(p => p.length > 0)

  // Score and extract the best contiguous block
  const scores = paragraphs.map(scoreParagraph)
  let bestStart = 0
  let bestEnd = 0
  let bestScore = 0
  let currentScore = 0
  let currentStart = 0

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < 0) {
      if (currentScore > bestScore) {
        bestScore = currentScore
        bestStart = currentStart
        bestEnd = i
      }
      currentScore = 0
      currentStart = i + 1
      continue
    }
    currentScore += scores[i]
    if (currentScore > bestScore) {
      bestScore = currentScore
      bestStart = currentStart
      bestEnd = i + 1
    }
  }

  if (currentScore > bestScore) {
    bestEnd = paragraphs.length
  }

  const contentParagraphs = paragraphs.slice(bestStart, bestEnd)
  const text = contentParagraphs.join('\n\n')

  return {
    title: stripTags(title),
    description: stripTags(description),
    text: normalizeWhitespace(text || paragraphs.slice(0, 40).join('\n\n')),
    datePublished,
    author,
    siteName: extractSiteName(html, url),
  }
}

/* ───────── Fetch with retry ───────── */

async function fetchWithRetry(
  url: URL,
  options: { signal?: AbortSignal; retries?: number } = {},
): Promise<Response> {
  const retries = options.retries ?? 1
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8, application/json;q=0.1',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: withTimeoutSignal(FETCH_TIMEOUT_MS, options.signal),
      })

      if (response.ok) return response

      // Retry on server errors or rate limits
      if (response.status >= 500 || response.status === 429) {
        if (attempt < retries) {
          await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1))
          continue
        }
      }

      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < retries) {
        await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url.href}`)
}

function readResponseText(response: Response, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const bodyReader = response.body?.getReader()
    if (!bodyReader) {
      resolve('')
      return
    }
    const reader = bodyReader

    const decoder = new TextDecoder()
    let buffer = ''
    let bytesRead = 0

    function pump(): Promise<void> {
      return reader.read().then(({ done, value }) => {
        if (done) return
        const chunk = decoder.decode(value, { stream: true })
        bytesRead += value?.length ?? 0
        buffer += chunk
        if (bytesRead >= maxBytes) {
          reader.cancel().catch(() => {})
          return
        }
        return pump()
      })
    }

    pump()
      .then(() => resolve(buffer))
      .catch(reject)
  })
}

/* ───────── Public API ───────── */

function searchResultsToSources(results: PublicWebSearchResult[]): MessageSource[] {
  return results.map((result, index) => ({
    filename: result.title,
    title: result.title,
    url: result.url,
    excerpt: result.snippet,
    content: result.snippet,
    score: Math.max(0.5, 1 - index * 0.08),
    mode: 'web',
  }))
}

export async function searchPublicWeb(
  query: string,
  options: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<PublicWebSearchResult[]> {
  const cleanQuery = query.trim()
  if (!cleanQuery) return []

  const maxResults = Math.min(Math.max(options.maxResults ?? MAX_SEARCH_RESULTS, 1), 10)
  const signal = options.signal

  // Build the list of *configured* providers. These are the ones with API
  // keys / endpoints set in the environment — they typically have rate
  // limits and (sometimes) per-query cost, so we want to be deliberate
  // about how many we hit at once. The always-on tier (DDG, Bing) is
  // separate because they have no rate limit worth worrying about.
  const configuredProviders: Array<{ label: string; search: typeof searchGoogle }> = []
  if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_CX) configuredProviders.push({ label: 'Google', search: searchGoogle })
  if (BRAVE_API_KEY) configuredProviders.push({ label: 'Brave', search: searchBrave })
  if (SEARXNG_URL) configuredProviders.push({ label: 'SearXNG', search: searchSearxng })

  // Race the top 2 configured providers in parallel. 2 is the safe bound:
  // typical configs are 0-2 paid providers, and 3 concurrent paid API
  // calls is right at the rate-limit cliff. If only 1 is configured, fall
  // through to sequential for that single call (the race adds no value
  // and the parallel code path is wasted overhead).
  if (configuredProviders.length >= 2) {
    const [first, second] = configuredProviders
    const settled = await Promise.allSettled([
      safeSearch(first.search, cleanQuery, maxResults, signal, first.label),
      safeSearch(second.search, cleanQuery, maxResults, signal, second.label),
    ])
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        return result.value
      }
    }
  } else if (configuredProviders.length === 1) {
    const only = configuredProviders[0]
    try {
      const results = await only.search(cleanQuery, maxResults, signal)
      if (results.length > 0) return results
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn(`${only.label} search failed:`, error)
    }
  }

  // Remaining configured providers (3rd, 4th, ...) fall through
  // sequentially. In practice this branch is rare (most deployments have
  // 0-2 paid providers) but we keep the safety net.
  for (let i = 2; i < configuredProviders.length; i += 1) {
    const provider = configuredProviders[i]
    try {
      const results = await provider.search(cleanQuery, maxResults, signal)
      if (results.length > 0) return results
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn(`${provider.label} search failed:`, error)
    }
  }

  // Always-on tier: DuckDuckGo, then Bing. Sequential — they're free,
  // they don't rate-limit us, and we want the result of one before
  // deciding whether to hit the other.
  try {
    const results = await searchDuckDuckGo(cleanQuery, maxResults, signal)
    if (results.length > 0) return results
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn('DuckDuckGo search failed, falling back to Bing:', error)
  }

  try {
    const results = await searchBing(cleanQuery, maxResults, signal)
    if (results.length > 0) return results
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn('Bing search failed:', error)
  }

  return []
}

async function safeSearch(
  fn: (query: string, maxResults: number, signal?: AbortSignal) => Promise<PublicWebSearchResult[]>,
  query: string,
  maxResults: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<PublicWebSearchResult[]> {
  try {
    return await fn(query, maxResults, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn(`${label} search failed:`, error)
    return []
  }
}

export async function fetchPublicWebPage(
  rawUrl: string,
  fallbackTitle = '',
  options: { signal?: AbortSignal } = {},
): Promise<MessageSource | null> {
  // Phase 3 of the web-trust plan: callers that want to *force* a particular
  // strategy can call `fetchAsReadableText` directly (it auto-upgrades to
  // browser when the fast path returns an empty shell). We keep this
  // function as the canonical fast-path entry point since most callers want
  // the cheap HTTPS fetch and don't need browser rendering.
  const safeUrl = await assertPublicHttpUrl(rawUrl)

  try {
    const response = await fetchWithRetry(safeUrl, { signal: options.signal, retries: 1 })

    if (!response.ok) {
      throw new Error(`Web fetch failed with ${response.status} for ${safeUrl.href}`)
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('application/xhtml+xml')
    ) {
      return null
    }

    const rawText = await readResponseText(response, MAX_RESPONSE_BYTES)

    if (contentType.includes('text/plain')) {
      const excerpt = truncate(normalizeWhitespace(rawText), MAX_SOURCE_EXCERPT_CHARS)
      if (!excerpt) return null
      return {
        filename: fallbackTitle || safeUrl.hostname,
        title: fallbackTitle || safeUrl.hostname,
        url: safeUrl.href,
        excerpt,
        content: excerpt,
        score: 1,
        mode: 'web',
      }
    }

    const extracted = extractReadableText(rawText, safeUrl)
    const excerpt = truncate(
      [extracted.description, extracted.text].filter(Boolean).join('\n\n'),
      MAX_SOURCE_EXCERPT_CHARS,
    )

    if (!excerpt) return null

    const title = extracted.title || fallbackTitle || safeUrl.hostname
    const dateNote = extracted.datePublished ? ` (Published: ${extracted.datePublished})` : ''

    return {
      filename: title,
      title,
      url: safeUrl.href,
      excerpt: excerpt + dateNote,
      content: excerpt,
      score: 1,
      mode: 'web',
    }
  } catch (error) {
    console.warn(`Failed to fetch page ${rawUrl}:`, error)
    return null
  }
}

function buildContext(query: string, sources: MessageSource[]): string {
  const sections = sources.map((source, index) => {
    const header = `[${index + 1}] ${source.title || source.filename}`
    const location = source.url ? `URL: ${source.url}` : ''
    const excerpt = source.excerpt || source.content

    return [header, location, excerpt].filter(Boolean).join('\n')
  })

  const citationInstructions = [
    'Answer using public web research.',
    'Cite every factual claim with inline [^N] markers.',
    'Use [^1][^3] for overlapping sources.',
    'Prefer recent authoritative sources.',
    'If evidence is thin, conflicting, or undated, say so.',
    'Only reference sources listed below — do not invent URLs or citations.',
  ].join(' ')

  return truncate(
    `${citationInstructions}\n\nSearch query: ${query}\n\n${sections.join('\n\n---\n\n')}`,
    MAX_CONTEXT_CHARS,
  )
}

interface BuildWebContextOptions {
  signal?: AbortSignal
  maxResults?: number
  maxPages?: number
}

export async function buildWebContext(
  query: string,
  options: BuildWebContextOptions = {},
): Promise<{ context: string; sources: MessageSource[] }> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return { context: '', sources: [] }
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? MAX_SEARCH_RESULTS, 1), 10)
  const maxPages = Math.min(Math.max(options.maxPages ?? MAX_FETCHED_PAGES, 1), 6)

  // Direct URLs in the query — fetch them directly
  const directUrls = extractUrlsFromText(cleanQuery)
  if (directUrls.length > 0) {
    const settled = await Promise.allSettled(
      directUrls.map(url => fetchPublicWebPage(url, '', { signal: options.signal })),
    )
    const sources = settled
      .flatMap(result => (result.status === 'fulfilled' && result.value ? [result.value] : []))
      .map((source, index) => ({ ...source, score: Math.max(0.6, 1 - index * 0.1) }))

    return {
      context: sources.length > 0 ? buildContext(cleanQuery, sources) : '',
      sources,
    }
  }

  // Generate multiple search queries for broader coverage
  const searchQueries = generateSearchQueries(cleanQuery)
  const allSearchResults: PublicWebSearchResult[] = []
  const seenUrls = new Set<string>()

  // Run each query variant in parallel — they don't share a Playwright
  // page (searchPublicWeb only makes outbound HTTPS calls), so racing
  // them is safe. Three variants × 8s each serializes to ~24s; parallel
  // is ~8s. The dedup/seenUrls merge is still sequential below.
  const settledSearches = await Promise.allSettled(
    searchQueries.map(sq => searchPublicWeb(sq, {
      maxResults: Math.ceil(maxResults / searchQueries.length) + 2,
      signal: options.signal,
    })),
  )
  for (const settled of settledSearches) {
    if (settled.status === 'rejected') {
      if (options.signal?.aborted) throw settled.reason
      console.warn(`Search query failed:`, settled.reason)
      continue
    }
    for (const r of settled.value) {
      const normalized = r.url.split('#')[0]
      if (!seenUrls.has(normalized)) {
        seenUrls.add(normalized)
        allSearchResults.push(r)
      }
    }
  }

  // Deduplicate and rank
  const uniqueResults = allSearchResults
    .filter((r, i, arr) => arr.findIndex(x => x.url.split('#')[0] === r.url.split('#')[0]) === i)
    .slice(0, maxResults)

  if (uniqueResults.length === 0) {
    return { context: '', sources: [] }
  }

  const searchSources = searchResultsToSources(uniqueResults)
  const safeResults = uniqueResults.slice(0, maxPages)
  const settled = await Promise.allSettled(
    safeResults.map(result => fetchPublicWebPage(result.url, result.title, { signal: options.signal })),
  )

  const fetchedSources = settled
    .flatMap((result, index) => {
      if (result.status !== 'fulfilled' || !result.value) return []
      return [
        {
          ...result.value,
          excerpt: result.value.excerpt || safeResults[index]?.snippet || result.value.content,
          content: result.value.content || safeResults[index]?.snippet || result.value.excerpt || '',
          score: Math.max(0.5, 1 - index * 0.1),
        },
      ]
    })

  const sources = fetchedSources.length > 0
    ? mergeMessageSources(fetchedSources, searchSources, maxResults)
    : searchSources

  return {
    context: sources.length > 0 ? buildContext(cleanQuery, sources) : '',
    sources: sources.slice(0, maxResults),
  }
}

/**
 * Test-only re-exports. The provider functions are not part of the
 * public API, but tests need to swap them out to assert the
 * configured-tier parallelism behaviour. Use `vi.spyOn` on these to
 * intercept calls from inside `searchPublicWeb`.
 */
export const __test__ = {
  searchGoogle,
  searchBrave,
  searchSearxng,
  searchDuckDuckGo,
  searchBing,
  safeSearch,
}
