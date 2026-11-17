import { describe, expect, it } from 'vitest'

import {
  __test__,
  ALL_CATEGORIES,
  canonicalizeUrl,
  classifyResult,
  clusterResults,
  dedupeAndClusterResults,
  dedupeResults,
  parseSearchResults,
  unwrapAhmiaRedirectUrl,
  type MinimalObservation,
  type ParsedSearchResult,
} from './uwaf-result-parser'
import { getSearchProviderById } from './uwaf-search-providers'

const STEALTH_IDS = ['ahmia', 'onionway', 'tor66', 'duckduckgo-onion']

function findProvider(id: string) {
  const provider = getSearchProviderById('stealth', id)
  if (!provider) throw new Error(`Provider not found: ${id}`)
  return provider
}

function observation(partial: Partial<MinimalObservation>): MinimalObservation {
  return {
    url: '',
    title: '',
    text: '',
    html: '',
    markdown: '',
    links: [],
    ...partial,
  }
}

describe('canonicalizeUrl', () => {
  it('returns the input unchanged when not a URL', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url')
    expect(canonicalizeUrl('')).toBe('')
  })

  it('lowercases the host', () => {
    expect(canonicalizeUrl('https://EXAMPLE.com/path')).toBe('https://example.com/path')
  })

  it('strips the www. prefix', () => {
    expect(canonicalizeUrl('https://www.example.com/path')).toBe('https://example.com/path')
  })

  it('strips trailing slashes from the path', () => {
    expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path')
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('drops common tracking query params but keeps others', () => {
    expect(
      canonicalizeUrl('https://example.com/page?id=42&utm_source=foo&fbclid=bar&q=hi'),
    ).toBe('https://example.com/page?id=42&q=hi')
  })

  it('preserves fragments and ports', () => {
    expect(canonicalizeUrl('https://example.com:8080/path#section')).toBe(
      'https://example.com:8080/path#section',
    )
  })

  it('treats http and https as different (no implicit upgrade)', () => {
    expect(canonicalizeUrl('http://example.com/')).not.toBe(canonicalizeUrl('https://example.com/'))
  })
})

describe('classifyResult', () => {
  it('classifies market-shaped rows', () => {
    expect(
      classifyResult({ url: 'https://darkmarketxyz.onion/', title: 'DarkMarket Vendor Shop' }),
    ).toBe('market')
  })

  it('classifies forum-shaped rows by path', () => {
    expect(
      classifyResult({
        url: 'https://example.onion/threads/abc',
        title: 'Random discussion',
        snippet: 'Posted in Off-Topic',
      }),
    ).toBe('forum')
  })

  it('classifies news-shaped rows with year mentions', () => {
    expect(
      classifyResult({ url: 'https://example.onion/', title: 'Leaked 2024 government cables' }),
    ).toBe('news')
  })

  it('classifies service-shaped rows', () => {
    expect(
      classifyResult({ url: 'https://example.onion/', title: 'Secure email service' }),
    ).toBe('service')
  })

  it('classifies link-list-shaped rows', () => {
    expect(
      classifyResult({ url: 'https://example.onion/wiki', title: 'Directory of onion links' }),
    ).toBe('link-list')
  })

  it('returns unknown for ambiguous rows', () => {
    expect(
      classifyResult({ url: 'https://example.onion/abc', title: 'Hello there', snippet: '' }),
    ).toBe('unknown')
  })

  it('counts every category in the rule list', () => {
    const seen = new Set(__test__.CATEGORY_RULES.map(r => r.category))
    for (const category of ALL_CATEGORIES) {
      // 'unknown' has no rules by design — every other category must.
      if (category === 'unknown') continue
      expect(seen.has(category), `missing rule for ${category}`).toBe(true)
    }
  })
})

describe('parseSearchResults — per-provider parsers', () => {
  it('Ahmia: extracts result links and drops site nav across clearnet and onion mirror', () => {
    const provider = findProvider('ahmia')
    const obs = observation({
      url: 'https://ahmia.fi/search/?q=foo',
      links: [
        { index: 0, text: 'Ahmia.fi', url: 'https://ahmia.fi/' },
        { index: 1, text: 'Submit a site', url: 'https://ahmia.fi/submit' },
        { index: 2, text: 'Blacklist', url: 'https://ahmia.fi/blacklist' },
        {
          index: 3,
          text: 'Mirror Privacy',
          url: 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/privacy',
        },
        {
          index: 4,
          text: 'Mirror Home',
          url: 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/',
        },
        { index: 5, text: 'Real dark-web result', url: 'http://real.onion/page' },
        { index: 6, text: 'Real dark-web result 2', url: 'http://real2.onion/' },
      ],
    })
    const results = parseSearchResults(obs, provider, 'foo')
    expect(results.map(r => r.url)).toEqual(['http://real.onion/page', 'http://real2.onion/'])
    expect(results[0]?.providerId).toBe('ahmia')
    expect(results[0]?.rank).toBe(1)
  })

  it('Ahmia: unwraps /search/redirect links to the underlying .onion target', () => {
    const provider = findProvider('ahmia')
    const wrappedClearnet =
      'https://ahmia.fi/search/redirect?search_term=news&redirect_url=http%3A%2F%2Fnewsabc123.onion%2Findex.html'
    const wrappedRelative =
      '/search/redirect?search_term=news&redirect_url=http://mirrorxyz789.onion/'
    const wrappedOnion =
      'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/redirect?search_term=news&redirect_url=http://onionportal.onion/feed'
    const nonAhmiaRedirect =
      'https://other.example/search/redirect?search_term=news&redirect_url=http://ignored.onion/'

    expect(unwrapAhmiaRedirectUrl(wrappedClearnet)).toBe('http://newsabc123.onion/index.html')
    expect(unwrapAhmiaRedirectUrl(wrappedRelative)).toBe('http://mirrorxyz789.onion/')
    expect(unwrapAhmiaRedirectUrl(wrappedOnion)).toBe('http://onionportal.onion/feed')
    expect(unwrapAhmiaRedirectUrl(nonAhmiaRedirect)).toBe(nonAhmiaRedirect)

    const obs = observation({
      url: 'https://ahmia.fi/search/?q=news',
      links: [
        { index: 0, text: 'Ahmia Legal', url: 'https://ahmia.fi/legal' },
        { index: 1, text: 'News Onion', url: wrappedClearnet },
        { index: 2, text: 'Mirror Onion', url: wrappedRelative },
        { index: 3, text: 'Onion Portal', url: wrappedOnion },
      ],
    })
    const results = parseSearchResults(obs, provider, 'news')
    expect(results.map(r => r.url)).toEqual([
      'http://newsabc123.onion/index.html',
      'http://mirrorxyz789.onion/',
      'http://onionportal.onion/feed',
    ])
  })

  it('OnionWay: drops the home/about chrome across clearnet and onion mirror but keeps the on-page search URL and real external results', () => {
    const provider = findProvider('onionway')
    const obs = observation({
      links: [
        { index: 0, text: 'Home', url: 'https://onionway.com/' },
        { index: 1, text: 'About', url: 'https://onionway.com/about.php' },
        {
          index: 2,
          text: 'Mirror Home',
          url: 'http://oniwayzz74cv2puhsgx4dpjwieww4wdphsydqvf5q7eyz4myjvyw26ad.onion/',
        },
        {
          index: 3,
          text: 'Mirror About',
          url: 'http://oniwayzz74cv2puhsgx4dpjwieww4wdphsydqvf5q7eyz4myjvyw26ad.onion/about.php',
        },
        { index: 4, text: 'Search results for "foo"', url: 'https://onionway.com/search.php?s=foo' },
        { index: 5, text: 'Real link', url: 'http://dark.onion/x' },
      ],
    })
    const results = parseSearchResults(obs, provider, 'foo')
    // Home and about are dropped. The on-page search URL and the real
    // external result both pass through (the parser keeps onionway.com
    // links only when they're search.php? — that is the on-page search
    // form URL, which the model might want to follow if it wants to
    // refine the query). The model can ignore it.
    expect(results.map(r => r.url)).toEqual([
      'https://onionway.com/search.php?s=foo',
      'http://dark.onion/x',
    ])
  })

  it('Tor66: drops tor66.org chrome and internal links while preserving external .onion results', () => {
    const provider = findProvider('tor66')
    const obs = observation({
      url: 'https://tor66.org/search?q=foo',
      links: [
        { index: 0, text: 'Tor66 Home', url: 'https://tor66.org/' },
        { index: 1, text: 'Search', url: 'https://tor66.org/search?q=foo' },
        { index: 2, text: 'About', url: 'https://tor66.org/about' },
        { index: 3, text: 'Blog', url: 'https://tor66.org/blog' },
        { index: 4, text: 'Add Onion', url: 'https://tor66.org/add' },
        { index: 5, text: 'Clearnet', url: 'https://tor66.org/clearnet' },
        { index: 6, text: 'External Onion', url: 'http://tor66result.onion/page' },
      ],
    })
    const results = parseSearchResults(obs, provider, 'foo')
    expect(results.map(r => r.url)).toEqual(['http://tor66result.onion/page'])
  })

  it('DuckDuckGo Onion: drops self-links to duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion', () => {
    const provider = findProvider('duckduckgo-onion')
    const obs = observation({
      url: 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/html/?q=foo',
      links: [
        {
          index: 0,
          text: 'DuckDuckGo',
          url: 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/html/',
        },
        {
          index: 1,
          text: 'Settings',
          url: 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/settings',
        },
        { index: 2, text: 'Result A', url: 'http://a.onion/x' },
        { index: 3, text: 'Result B', url: 'https://example.org/y' },
      ],
    })
    const results = parseSearchResults(obs, provider, 'foo')
    expect(results.map(r => r.url)).toEqual(['http://a.onion/x', 'https://example.org/y'])
  })

  it('Env-backed legacy parsers (OnionLand, TorDex, Excavator): drop self-links when invoked', () => {
    const base = findProvider('tor66')

    const onionlandResults = parseSearchResults(
      observation({
        links: [
          { index: 0, text: 'OnionLand home', url: 'https://www.onionland.to/' },
          { index: 1, text: 'About', url: 'https://www.onionland.to/about' },
          { index: 2, text: 'Result A', url: 'http://a.onion/x' },
        ],
      }),
      { ...base, id: 'onionland' },
      'foo',
    )
    expect(onionlandResults.map(r => r.url)).toEqual(['http://a.onion/x'])

    const tordexResults = parseSearchResults(
      observation({
        links: [
          { index: 0, text: 'TorDex home', url: 'https://tordex.app/' },
          { index: 1, text: 'Result', url: 'http://a.onion/x' },
        ],
      }),
      { ...base, id: 'tordex' },
      'foo',
    )
    expect(tordexResults.map(r => r.url)).toEqual(['http://a.onion/x'])

    const excavatorResults = parseSearchResults(
      observation({
        links: [
          { index: 0, text: 'About Excavator', url: 'https://excavatorsearchengine.com/about' },
          { index: 1, text: 'Real result', url: 'http://a.onion/x' },
        ],
      }),
      { ...base, id: 'excavator' },
      'foo',
    )
    expect(excavatorResults.map(r => r.url)).toEqual(['http://a.onion/x'])
  })

  it('falls back to passthrough parser for unknown provider ids', () => {
    const obs = observation({
      links: [
        { index: 0, text: 'A', url: 'http://a.onion/x' },
        { index: 1, text: 'B', url: 'http://b.onion/y' },
      ],
    })
    // Pick the first real provider and pretend it's an unknown by overriding
    // the parser registry. We test the fallback by reaching into __test__.
    const original = __test__.PARSERS['ahmia']
    delete (__test__.PARSERS as Record<string, unknown>)['ahmia']
    try {
      const provider = findProvider('ahmia')
      const results = parseSearchResults(obs, provider, 'foo')
      expect(results.length).toBe(2)
    } finally {
      ;(__test__.PARSERS as Record<string, unknown>)['ahmia'] = original
    }
  })

  it('returns an empty list for an empty observation', () => {
    const provider = findProvider('ahmia')
    expect(parseSearchResults(observation({}), provider, 'foo')).toEqual([])
  })

  it('uses the URL hostname as a fallback title when the anchor text is empty', () => {
    const provider = findProvider('ahmia')
    const obs = observation({
      links: [{ index: 0, text: '', url: 'http://silent.onion/path' }],
    })
    const results = parseSearchResults(obs, provider, 'foo')
    expect(results[0]?.title).toBe('silent.onion')
  })
})

describe('dedupeResults', () => {
  function r(url: string, rank: number, snippet = ''): ParsedSearchResult {
    return {
      url: canonicalizeUrl(url),
      title: url,
      snippet,
      category: 'unknown',
      providerId: 'test',
      rank,
    }
  }

  it('keeps the lowest rank when the same URL appears with different ranks', () => {
    const a = r('http://example.com/p', 1, 'short')
    const b = r('http://example.com/p', 5, 'a longer snippet wins over a shorter one')
    const dedup = dedupeResults([[a], [b]])
    expect(dedup.results.length).toBe(1)
    // rank-1 is preferred (a smaller score wins the comparison).
    expect(dedup.results[0]?.rank).toBe(1)
  })

  it('keeps the longer snippet when ranks tie', () => {
    const a = r('http://example.com/p', 3, 'short')
    const b = r('http://example.com/p', 3, 'a much longer snippet text goes here')
    const dedup = dedupeResults([[a], [b]])
    expect(dedup.results.length).toBe(1)
    expect(dedup.results[0]?.snippet).toBe(b.snippet)
  })

  it('treats www/no-www as the same URL', () => {
    const dedup = dedupeResults([
      [r('http://www.example.com/p', 1)],
      [r('http://example.com/p', 2)],
    ])
    expect(dedup.stats).toEqual({ input: 2, unique: 1, dropped: 1 })
  })

  it('treats http and https as different URLs', () => {
    const dedup = dedupeResults([
      [r('http://example.com/p', 1)],
      [r('https://example.com/p', 1)],
    ])
    expect(dedup.stats).toEqual({ input: 2, unique: 2, dropped: 0 })
  })

  it('drops trailing slashes', () => {
    const dedup = dedupeResults([
      [r('http://example.com/p/', 1)],
      [r('http://example.com/p', 2)],
    ])
    expect(dedup.stats.dropped).toBe(1)
  })

  it('drops tracking query params before comparing', () => {
    const dedup = dedupeResults([
      [r('http://example.com/p?utm_source=foo', 1)],
      [r('http://example.com/p?ref=bar', 2)],
    ])
    expect(dedup.stats.dropped).toBe(1)
  })

  it('preserves the original rank order across multiple providers', () => {
    const listA = [r('http://a.com', 1), r('http://b.com', 2), r('http://c.com', 3)]
    const listB = [r('http://a.com', 1), r('http://d.com', 2)]
    const dedup = dedupeResults([listA, listB])
    // After dedup: a (rank 1), b (rank 2), d (rank 2 — stable order, last
    // source for the tied ranks wins, so d comes after b), c (rank 3).
    // canonicalizeUrl adds '/' for an empty path.
    expect(dedup.results.map(x => x.url)).toEqual([
      'http://a.com/',
      'http://b.com/',
      'http://d.com/',
      'http://c.com/',
    ])
  })
})

describe('clusterResults', () => {
  function r(category: ParsedSearchResult['category'], rank: number): ParsedSearchResult {
    return {
      url: `http://example.com/${category}/${rank}`,
      title: `${category} ${rank}`,
      snippet: '',
      category,
      providerId: 'test',
      rank,
    }
  }

  it('groups results by category', () => {
    const cluster = clusterResults([r('forum', 2), r('market', 1), r('forum', 1)])
    expect(cluster.categories.market.length).toBe(1)
    expect(cluster.categories.forum.length).toBe(2)
    expect(cluster.total).toBe(3)
  })

  it('orders present categories for display', () => {
    const cluster = clusterResults([r('unknown', 1), r('market', 1), r('news', 1)])
    expect(cluster.presentCategories).toEqual(['market', 'news', 'unknown'])
  })

  it('preserves rank order within a category', () => {
    const cluster = clusterResults([r('forum', 5), r('forum', 2), r('forum', 8)])
    expect(cluster.categories.forum.map(x => x.rank)).toEqual([2, 5, 8])
  })
})

describe('dedupeAndClusterResults — symmetry across all 4 active stealth providers', () => {
  it('produces zero duplicates when the same query goes to all 4 active providers with URL overlap', () => {
    const allUrls = Array.from({ length: 6 }, (_, i) => `http://a${i}.onion/`)
    const providerLists = [
      [allUrls[0], allUrls[1], allUrls[2], allUrls[3]],
      [allUrls[1], allUrls[2], allUrls[3], allUrls[4]],
      [allUrls[2], allUrls[3], allUrls[4], allUrls[5]],
      [allUrls[0], allUrls[2], allUrls[4], allUrls[5]],
    ]

    const observations = providerLists.map((urls, i) => ({
      provider: findProvider(STEALTH_IDS[i]!),
      observation: observation({
        links: urls.map((url, j) => ({ index: j, text: url, url })),
      }),
      query: 'symmetry test',
    }))

    const { results, dedupStats } = dedupeAndClusterResults(observations)
    const total = providerLists.reduce((s, l) => s + l.length, 0)
    expect(dedupStats.input).toBe(total)
    // 6 unique URLs.
    expect(dedupStats.unique).toBe(6)
    expect(dedupStats.dropped).toBe(total - 6)
    expect(results.length).toBe(6)
    expect(new Set(results.map(r => r.url)).size).toBe(6)
  })

  it('returns an empty cluster when no observations are provided', () => {
    const { results, cluster, dedupStats } = dedupeAndClusterResults([])
    expect(results).toEqual([])
    expect(cluster.total).toBe(0)
    expect(cluster.presentCategories).toEqual([])
    expect(dedupStats).toEqual({ input: 0, unique: 0, dropped: 0 })
  })
})
