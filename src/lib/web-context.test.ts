import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

type PublicWebSearchResult = {
  title: string
  url: string
  snippet: string
}

function buildResult(url: string, title = url): PublicWebSearchResult {
  return { title, url, snippet: `snippet for ${url}` }
}

function resetEnv() {
  vi.resetModules()
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
}

beforeEach(() => {
  resetEnv()
})

afterEach(() => {
  resetEnv()
  globalThis.fetch = originalFetch
})

async function loadWebContext() {
  return await import('./web-context')
}

describe('web-context: searchPublicWeb basic shape', () => {
  it('returns [] for empty query without hitting any provider', async () => {
    delete process.env.GOOGLE_SEARCH_API_KEY
    delete process.env.BRAVE_API_KEY
    delete process.env.SEARXNG_URL
    const { searchPublicWeb } = await loadWebContext()
    expect(await searchPublicWeb('   ')).toEqual([])
  })
})

describe('web-context: configured-tier parallelism (1 provider = sequential)', () => {
  it('calls Brave exactly once when it is the only configured provider', async () => {
    process.env.BRAVE_API_KEY = 'test_key'
    delete process.env.GOOGLE_SEARCH_API_KEY
    delete process.env.GOOGLE_SEARCH_CX
    delete process.env.SEARXNG_URL

    const fetchCalls: Array<{ url: string; startedAt: number }> = []
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      fetchCalls.push({ url, startedAt: Date.now() })
      // Simulate a fast response from Brave.
      await new Promise(r => setTimeout(r, 50))
      return new Response(
        JSON.stringify({ web: { results: [{ title: 'Brave result', url: 'https://brave.example.com/r', description: 'desc' }] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const { searchPublicWeb } = await loadWebContext()
    const results = await searchPublicWeb('single provider test', { maxResults: 3 })
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Brave result')
    // Only one fetch (Brave). No DDG, no Bing.
    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0].url).toContain('brave.com')
  })
})

describe('web-context: configured-tier parallelism (2+ providers = parallel)', () => {
  it('calls Google and Brave in parallel when both are configured', async () => {
    process.env.BRAVE_API_KEY = 'test_key'
    process.env.GOOGLE_SEARCH_API_KEY = 'test_google'
    process.env.GOOGLE_SEARCH_CX = 'test_cx'
    delete process.env.SEARXNG_URL

    const fetchCalls: Array<{ url: string; startedAt: number }> = []
    const PER_FETCH_LATENCY_MS = 300
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const startedAt = Date.now()
      fetchCalls.push({ url, startedAt })
      await new Promise(r => setTimeout(r, PER_FETCH_LATENCY_MS))
      // Return a recognizable response for each backend.
      const isGoogle = url.includes('googleapis.com')
      const isBrave = url.includes('brave.com')
      if (isGoogle) {
        return new Response(
          JSON.stringify({ items: [{ title: 'Google result', link: 'https://google.example.com/r', snippet: 'gdesc' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (isBrave) {
        return new Response(
          JSON.stringify({ web: { results: [{ title: 'Brave result', url: 'https://brave.example.com/r', description: 'bdesc' }] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    const { searchPublicWeb } = await loadWebContext()
    const start = Date.now()
    const results = await searchPublicWeb('parallel test', { maxResults: 3 })
    const wall = Date.now() - start

    // Both providers were called.
    expect(fetchCalls.length).toBe(2)
    // They started within ~50ms of each other (parallel).
    const spread = Math.max(...fetchCalls.map(c => c.startedAt)) - Math.min(...fetchCalls.map(c => c.startedAt))
    expect(spread).toBeLessThan(50)
    // Wall time is ~300ms (parallel) not 600ms (sequential).
    expect(wall).toBeLessThan(500)
    expect(results.length).toBe(1)
  })

  it('falls through to the always-on tier when both configured providers fail', async () => {
    process.env.BRAVE_API_KEY = 'test_key'
    process.env.GOOGLE_SEARCH_API_KEY = 'test_google'
    process.env.GOOGLE_SEARCH_CX = 'test_cx'
    delete process.env.SEARXNG_URL

    const fetchCalls: string[] = []
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      fetchCalls.push(url)
      if (url.includes('googleapis.com') || url.includes('brave.com')) {
        // Configured providers return errors.
        return new Response('{}', { status: 500 })
      }
      if (url.includes('duckduckgo.com')) {
        // Match the html.duckduckgo.com URL with a result block.
        // Attribute order matters — the real regex expects `href` before `class`.
        return new Response(
          '<div class="result"><a href="https://duckduckgo.example.com/r" class="result__a">DDG Title</a><a class="result__snippet">snippet</a></div><div class="result"></div>',
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        )
      }
      if (url.includes('bing.com')) {
        // Match Bing with no parseable results.
        return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    const { searchPublicWeb } = await loadWebContext()
    const results = await mod_searchPublicWeb(searchPublicWeb, 'fallthrough test', 3)

    // Both configured providers were called.
    expect(fetchCalls.some(u => u.includes('googleapis.com'))).toBe(true)
    expect(fetchCalls.some(u => u.includes('brave.com'))).toBe(true)
    // Always-on tier was reached.
    expect(fetchCalls.some(u => u.includes('duckduckgo.com'))).toBe(true)
    expect(results.length).toBeGreaterThan(0)
  })
})

// Helper used inside the fallthrough test to avoid "mod is not defined"
// when typed inline.
async function mod_searchPublicWeb(
  searchPublicWeb: (q: string, opts?: { maxResults?: number; signal?: AbortSignal }) => Promise<PublicWebSearchResult[]>,
  q: string,
  max: number,
) {
  return await searchPublicWeb(q, { maxResults: max })
}

describe('web-context: buildWebContext query-variant parallelism', () => {
  it('runs query variants in parallel against a mocked public web', async () => {
    delete process.env.GOOGLE_SEARCH_API_KEY
    delete process.env.BRAVE_API_KEY
    delete process.env.SEARXNG_URL

    const fetchCalls: Array<{ url: string; startedAt: number }> = []
    const PER_FETCH_LATENCY_MS = 400
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const startedAt = Date.now()
      fetchCalls.push({ url, startedAt })
      await new Promise(r => setTimeout(r, PER_FETCH_LATENCY_MS))
      // DDG returns a small set of results. Attribute order matters —
      // the real regex expects `href` before `class`.
      if (url.includes('duckduckgo.com')) {
        return new Response(
          '<div class="result"><a href="https://example.com/1" class="result__a">T1</a><a class="result__snippet">s1</a></div><div class="result"></div>',
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        )
      }
      // Bing returns empty (used as a fallback).
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } })
    }) as typeof fetch

    const mod = await loadWebContext()
    const queries = mod.generateSearchQueries('What is the difference between iPhone vs Android')
    expect(queries.length).toBeGreaterThanOrEqual(2)

    const start = Date.now()
    const out = await mod.buildWebContext('What is the difference between iPhone vs Android', { maxResults: 5 })
    const wall = Date.now() - start

    // We expect N DDG fetches (one per query variant) plus 1 fetch
    // per deduped result page (in buildWebContext's second phase).
    // The key signal: all N variant fetches started at roughly the same
    // instant, which proves the first phase is parallel.
    const ddgCalls = fetchCalls.filter(c => c.url.includes('duckduckgo.com'))
    // Each query variant may produce the same DDG URL, so 2-3 fetches
    // is the expected range depending on dedup.
    expect(ddgCalls.length).toBeGreaterThanOrEqual(queries.length)
    if (ddgCalls.length >= 2) {
      const spread = Math.max(...ddgCalls.map(c => c.startedAt)) - Math.min(...ddgCalls.map(c => c.startedAt))
      expect(spread).toBeLessThan(100)
    }
    // Wall time should be ~PER_FETCH_LATENCY_MS, not queries.length × that.
    expect(wall).toBeLessThan(queries.length * PER_FETCH_LATENCY_MS - 100)
    expect(out.sources.length).toBeGreaterThan(0)
  })
})
