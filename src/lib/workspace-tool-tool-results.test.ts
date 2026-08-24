import { describe, expect, it } from 'vitest'
import {
  __test__,
  formatUwafBrowserToolResult,
  type UwafBrowserToolResultEntry,
} from './workspace-tool-tool-results'

function buildBaseEntry(overrides: Partial<UwafBrowserToolResultEntry> = {}): UwafBrowserToolResultEntry {
  return {
    action: 'open',
    currentUrl: 'https://example.com/article',
    title: 'Example Page',
    links: [],
    forms: [],
    mode: 'direct',
    source: 'clear_web',
    success: true,
    ...overrides,
  }
}

describe('workspace-tool-tool-results: truncateWithMarker', () => {
  it('returns the input unchanged when under the cap', () => {
    expect(__test__.truncateWithMarker('short text', 100)).toBe('short text')
  })

  it('truncates and appends a marker when over the cap', () => {
    const big = 'x'.repeat(1_000)
    const out = __test__.truncateWithMarker(big, 200)
    expect(out.startsWith('x'.repeat(200))).toBe(true)
    expect(out).toContain('more characters truncated')
    expect(out).toContain('full content visible in the live browser pane')
  })

  it('reports the correct dropped count in the marker', () => {
    const big = 'y'.repeat(500)
    const out = __test__.truncateWithMarker(big, 100)
    // 500 - 100 = 400 dropped
    expect(out).toContain('400 more characters truncated')
  })

  it('truncates exactly at the cap (no overshoot from the marker)', () => {
    const big = 'z'.repeat(10_000)
    const out = __test__.truncateWithMarker(big, 1_000)
    // Output = 1,000 chars of z + marker. Total well under 2x the cap.
    expect(out.length).toBeLessThan(1_500)
  })
})

describe('workspace-tool-tool-results: compactLinks', () => {
  it('returns the input array unchanged when empty', () => {
    expect(__test__.compactLinks([])).toEqual([])
  })

  it('keeps all real links when under the cap', () => {
    const links = [
      { index: 0, text: 'a', url: 'https://a.example.com' },
      { index: 1, text: 'b', url: 'https://b.example.com' },
    ]
    expect(__test__.compactLinks(links)).toEqual(links)
  })

  it('strips data:image URLs (inlined base64 images)', () => {
    const links = [
      { index: 0, text: 'real', url: 'https://a.example.com' },
      { index: 1, text: 'img', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...' },
      { index: 2, text: 'real2', url: 'https://b.example.com' },
    ]
    const out = __test__.compactLinks(links)
    expect(out).toHaveLength(2)
    expect(out[0].url).toBe('https://a.example.com')
    expect(out[1].url).toBe('https://b.example.com')
  })

  it('strips URLs containing ;base64,', () => {
    const links = [
      { index: 0, text: 'svg', url: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDov...' },
      { index: 1, text: 'real', url: 'https://x.example.com' },
    ]
    const out = __test__.compactLinks(links)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('real')
  })

  it('strips oversized URLs (> MAX_LINK_URL_LENGTH)', () => {
    const huge = 'https://example.com/?q=' + 'a'.repeat(2_500)
    const links = [
      { index: 0, text: 'huge', url: huge },
      { index: 1, text: 'real', url: 'https://x.example.com' },
    ]
    const out = __test__.compactLinks(links)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('real')
  })

  it('caps the link list at MAX_LINKS (60)', () => {
    const links = Array.from({ length: 100 }, (_, i) => ({
      index: i,
      text: `link ${i}`,
      url: `https://x.example.com/${i}`,
    }))
    const out = __test__.compactLinks(links)
    expect(out).toHaveLength(__test__.MAX_LINKS)
  })

  it('filters before capping (stops at first MAX_LINKS real links)', () => {
    // 200 real + 50 base64 junk in front. After filtering we still have 200.
    // The cap should be hit at 60.
    const links: UwafBrowserToolResultEntry['links'] = []
    for (let i = 0; i < 50; i++) {
      links.push({ index: i, text: 'junk', url: `data:image/png;base64,xxx${i}` })
    }
    for (let i = 0; i < 200; i++) {
      links.push({ index: 1000 + i, text: `real ${i}`, url: `https://x.example.com/${i}` })
    }
    const out = __test__.compactLinks(links)
    expect(out).toHaveLength(__test__.MAX_LINKS)
    expect(out[0].text).toBe('real 0')
    expect(out[out.length - 1].text).toBe(`real ${__test__.MAX_LINKS - 1}`)
  })

  it('treats empty/whitespace URLs as junk', () => {
    const links = [
      { index: 0, text: 'empty', url: '' },
      { index: 1, text: 'ws', url: '   ' },
      { index: 2, text: 'real', url: 'https://x.example.com' },
    ]
    const out = __test__.compactLinks(links)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('real')
  })
})

describe('workspace-tool-tool-results: isJunkLinkUrl', () => {
  it('flags data:image and ;base64, as junk', () => {
    expect(__test__.isJunkLinkUrl('data:image/png;base64,abc')).toBe(true)
    expect(__test__.isJunkLinkUrl('data:image/svg+xml;utf8,<svg/>')).toBe(true)
  })

  it('flags oversized URLs as junk', () => {
    const huge = 'https://example.com/' + 'a'.repeat(2_500)
    expect(__test__.isJunkLinkUrl(huge)).toBe(true)
  })

  it('accepts normal https URLs', () => {
    expect(__test__.isJunkLinkUrl('https://example.com')).toBe(false)
    expect(__test__.isJunkLinkUrl('https://example.com/path?query=1#fragment')).toBe(false)
  })

  it('accepts empty as junk', () => {
    expect(__test__.isJunkLinkUrl('')).toBe(true)
  })
})

describe('formatUwafBrowserToolResult — text truncation', () => {
  it('passes through small text without a truncation marker', () => {
    const entry = buildBaseEntry({ text: 'short article body that fits comfortably under the cap' })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Page content:')
    expect(out).toContain('short article body')
    expect(out).not.toContain('truncated')
  })

  it('caps open-action page text at ~6,000 chars with a marker', () => {
    const long = 'A'.repeat(20_000)
    const entry = buildBaseEntry({ action: 'open', text: long })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('truncated')
    // The text block alone (between the Page content: label and the next
    // section, or the end of the message) should be at most ~6,200 chars.
    // Easier assertion: total output is much smaller than the raw 20K input.
    expect(out.length).toBeLessThan(8_000)
  })

  it('caps search-action page text tighter (~2,000 chars)', () => {
    const long = 'B'.repeat(15_000)
    const entry = buildBaseEntry({ action: 'search', text: long })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('truncated')
    // Tighter cap → smaller total output.
    expect(out.length).toBeLessThan(3_500)
  })

  it('uses the markdown field when text is empty', () => {
    const entry = buildBaseEntry({ text: undefined, markdown: 'small md body' })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Page content (Markdown):')
    expect(out).toContain('small md body')
  })

  it('truncates markdown with the same action-based budget', () => {
    const md = '# Heading\n\n' + 'C'.repeat(15_000)
    const entry = buildBaseEntry({ action: 'search', text: undefined, markdown: md })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('truncated')
    expect(out.length).toBeLessThan(3_500)
  })
})

describe('formatUwafBrowserToolResult — link list', () => {
  it('emits a real link', () => {
    const entry = buildBaseEntry({
      links: [{ index: 0, text: 'Google', url: 'https://google.com' }],
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Links:')
    expect(out).toContain('[0] Google -> https://google.com')
  })

  it('strips data:image URLs from the link list', () => {
    const entry = buildBaseEntry({
      links: [
        { index: 0, text: 'img', url: 'data:image/png;base64,iVBORw0KGgoAAAA...' },
        { index: 1, text: 'real', url: 'https://example.com' },
      ],
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).not.toContain('data:image')
    expect(out).toContain('https://example.com')
  })

  it('caps the link list at 60 even when 100 are provided', () => {
    const links = Array.from({ length: 100 }, (_, i) => ({
      index: i,
      text: `link ${i}`,
      url: `https://x.example.com/${i}`,
    }))
    const entry = buildBaseEntry({ links })
    const out = formatUwafBrowserToolResult(entry)
    const linkLines = out.split('\n').filter(line => line.startsWith('- [') && line.includes('->'))
    expect(linkLines).toHaveLength(60)
  })
})

describe('formatUwafBrowserToolResult — failure path', () => {
  it('returns a terse failure message (not truncated) when success=false', () => {
    const entry = buildBaseEntry({
      success: false,
      error: 'navigation timeout',
      failureCode: 'NAV_TIMEOUT',
      // Even with a huge text field, the failure path doesn't include it.
      text: 'X'.repeat(20_000),
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Status: failed')
    expect(out).toContain('Error: navigation timeout')
    expect(out).toContain('Failure code: NAV_TIMEOUT')
    // The failure path doesn't emit Page content; the long text should not
    // leak in.
    expect(out).not.toContain('Page content:')
    expect(out).not.toContain('truncated')
    expect(out.length).toBeLessThan(1_000)
  })
})

describe('formatUwafBrowserToolResult — structural sections', () => {
  it('emits forms verbatim (no truncation)', () => {
    const entry = buildBaseEntry({
      forms: [
        {
          index: 0,
          action: 'https://example.com/login',
          method: 'POST',
          fields: [
            { name: 'user', type: 'text' },
            { name: 'pass', type: 'password' },
          ],
        },
      ],
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Forms:')
    expect(out).toContain('POST https://example.com/login')
    expect(out).toContain('user (text)')
    expect(out).toContain('pass (password)')
  })

  it('emits tables verbatim (no truncation)', () => {
    const entry = buildBaseEntry({
      tables: [
        {
          headers: ['A', 'B'],
          rows: [['1', '2'], ['3', '4']],
          markdown: '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |',
          csv: 'A,B\n1,2\n3,4',
        },
      ],
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Tables:')
    expect(out).toContain('Table 1: 2 columns, 2 rows')
    expect(out).toContain('| A | B |')
  })

  it('emits batchResults with the existing 500-char preview cap', () => {
    const long = 'D'.repeat(2_000)
    const entry = buildBaseEntry({
      batchResults: [
        { url: 'https://x.example.com/a', title: 'A', markdown: long, links: [], depth: 1 },
      ],
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Research batch: 1 pages crawled')
    expect(out).toContain('Content preview: ' + 'D'.repeat(500) + '...')
  })

  it('emits tabs verbatim', () => {
    const entry = buildBaseEntry({
      tabs: [
        { index: 0, url: 'https://a.example.com', title: 'A', active: true },
        { index: 1, url: 'https://b.example.com', title: 'B', active: false },
      ],
    })
    const out = formatUwafBrowserToolResult(entry)
    expect(out).toContain('Tabs:')
    expect(out).toContain('* A -> https://a.example.com')
    expect(out).toContain('  B -> https://b.example.com')
  })
})

describe('formatUwafBrowserToolResult — end-to-end crash fixture', () => {
  it('caps a 25K Brave SERP to a manageable tool result', () => {
    // Simulate the actual crash: 25K-char SERP text with 80 links, half
    // of which are data:image or oversized URLs.
    const links: UwafBrowserToolResultEntry['links'] = []
    for (let i = 0; i < 40; i++) {
      links.push({ index: i, text: 'icon', url: `data:image/png;base64,${'A'.repeat(100)}` })
    }
    for (let i = 0; i < 40; i++) {
      links.push({ index: 100 + i, text: `result ${i}`, url: `https://search.example.com/result/${i}` })
    }
    const text = 'Search results for "options flow dark pool today"\n\n' +
      'Navigation Home Images News Videos Maps More View all Settings Tools\n\n' +
      'Result blocks (40):\n' +
      Array.from({ length: 40 }, (_, i) =>
        `Block ${i}: Some title with options data and dark pool information. ` +
        'a'.repeat(500),
      ).join('\n\n')

    const entry = buildBaseEntry({
      action: 'search',
      currentUrl: 'https://search.brave.com/search?q=options+flow',
      title: 'Search Results',
      text,
      links,
    })

    const out = formatUwafBrowserToolResult(entry)

    // 1. Total output is bounded — far smaller than the raw 25K input.
    expect(out.length).toBeLessThan(8_000)
    // 2. The truncation marker is present so the model knows it happened.
    expect(out).toContain('truncated')
    // 3. No data:image URLs leaked through.
    expect(out).not.toContain('data:image')
    // 4. We did keep the 40 real search-result links (under the 60 cap).
    const linkLines = out.split('\n').filter(line => line.startsWith('- [') && line.includes('->'))
    expect(linkLines.length).toBe(40)
    // 5. The metadata at the top is preserved (so the model can see
    //    which query it ran, the URL, the title, etc.).
    expect(out).toContain('Action: search')
    expect(out).toContain('URL: https://search.brave.com/search?q=options+flow')
    expect(out).toContain('Title: Search Results')
  })
})

describe('humanizeUwafFailureCode', () => {
  it('returns null for empty or null inputs', () => {
    expect(__test__.humanizeUwafFailureCode(null)).toBeNull()
    expect(__test__.humanizeUwafFailureCode(undefined)).toBeNull()
    expect(__test__.humanizeUwafFailureCode('')).toBeNull()
    expect(__test__.humanizeUwafFailureCode('   ')).toBeNull()
  })

  it('humanizes tor_unavailable with the canonical guidance keyword', () => {
    const out = __test__.humanizeUwafFailureCode('tor_unavailable')
    expect(out?.short).toContain('Tor proxy is unreachable')
    expect(out?.detail).toContain('TOR_PROXY_URL')
  })

  it('humanizes timeout differently for .onion vs clear-web', () => {
    const clear = __test__.humanizeUwafFailureCode('timeout', { isOnion: false })
    const onion = __test__.humanizeUwafFailureCode('timeout', { isOnion: true })
    expect(clear?.short).toContain('site did not respond')
    expect(onion?.short).toContain('.onion site did not respond')
  })

  it('humanizes anti_bot_detected with the wait_for_user next step', () => {
    const out = __test__.humanizeUwafFailureCode('anti_bot_detected')
    expect(out?.short).toContain('CAPTCHA')
    expect(out?.detail).toContain('wait_for_user')
  })

  it('humanizes login_required with the wait_for_user next step', () => {
    const out = __test__.humanizeUwafFailureCode('login_required')
    expect(out?.detail).toContain('wait_for_user')
  })

  it('humanizes onion_not_found with the v3 length reminder', () => {
    const out = __test__.humanizeUwafFailureCode('onion_not_found')
    expect(out?.short).toContain('.onion address is unreachable')
    expect(out?.detail).toContain('v3 .onion is 56')
    expect(out?.detail).toContain('verified unreachable after 2 attempts')
  })

  it('humanizes search_failed + zero results as "all providers returned zero"', () => {
    const out = __test__.humanizeUwafFailureCode('search_failed', { resultCount: 0 })
    expect(out?.short).toContain('zero results')
    expect(out?.detail).toContain('Direct mode')
  })

  it('humanizes search_failed + non-zero results as "results did not match"', () => {
    const out = __test__.humanizeUwafFailureCode('search_failed', { resultCount: 5 })
    expect(out?.short).toContain('did not produce a usable results page')
  })

  it('humanizes empty_response', () => {
    const out = __test__.humanizeUwafFailureCode('empty_response')
    expect(out?.short).toContain('empty body')
  })

  it('humanizes homepage_bounce', () => {
    const out = __test__.humanizeUwafFailureCode('homepage_bounce')
    expect(out?.short).toContain('search homepage')
  })

  it('humanizes unknown codes with a generic message that quotes the original', () => {
    const out = __test__.humanizeUwafFailureCode('mystery_code')
    expect(out?.short).toContain('failed')
    expect(out?.detail).toContain('mystery_code')
  })
})

describe('formatUwafBrowserToolResult — failure-path humanization', () => {
  it('emits a "What this means" + "Next step" block for tor_unavailable', () => {
    const out = formatUwafBrowserToolResult(buildBaseEntry({
      action: 'search',
      mode: 'stealth',
      source: 'dark_web',
      success: false,
      failureCode: 'tor_unavailable',
      error: 'Tor proxy is down',
      currentUrl: '',
      title: '',
    }))
    expect(out).toContain('What this means:')
    expect(out).toContain('Tor proxy is unreachable')
    expect(out).toContain('Next step:')
    expect(out).toContain('TOR_PROXY_URL')
  })

  it('emits a "verified unreachable after 2 attempts" detail for onion_not_found', () => {
    const out = formatUwafBrowserToolResult(buildBaseEntry({
      action: 'open',
      mode: 'stealth',
      source: 'dark_web',
      success: false,
      failureCode: 'onion_not_found',
      currentUrl: 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/',
      title: 'Ahmia',
    }))
    expect(out).toContain('verified unreachable after 2 attempts')
  })
})

describe('formatUwafBrowserToolResult — clustered results digest', () => {
  it('emits a "Clustered results" section with categories when the digest is present', () => {
    const out = formatUwafBrowserToolResult(buildBaseEntry({
      action: 'search',
      mode: 'stealth',
      source: 'dark_web',
      success: true,
      currentUrl: 'https://ahmia.fi/search/?q=foo',
      title: 'Ahmia',
      links: [
        { index: 0, text: 'A', url: 'http://a.onion/' },
        { index: 1, text: 'B', url: 'http://b.onion/' },
      ],
      clusteredResults: {
        categories: {
          market: [
            { url: 'http://a.onion/', title: 'Dark Market', snippet: 'vendor listings', category: 'market', providerId: 'ahmia', rank: 1 },
          ],
          forum: [
            { url: 'http://b.onion/', title: 'Discussion Board', snippet: 'forum threads', category: 'forum', providerId: 'onionway', rank: 1 },
          ],
          'link-list': [],
          news: [],
          service: [],
          unknown: [],
        },
        total: 2,
        presentCategories: ['market', 'forum'],
        dedupStats: { input: 4, unique: 2, dropped: 2 },
        providersUsed: ['ahmia', 'onionway'],
      },
    }))
    expect(out).toContain('Clustered results (2 unique after dedup of 4')
    expect(out).toContain('providers: ahmia, onionway')
    expect(out).toContain('[market]')
    expect(out).toContain('Dark Market -> http://a.onion/')
    expect(out).toContain('[forum]')
  })

  it('does not emit the clustered section when total is zero', () => {
    const out = formatUwafBrowserToolResult(buildBaseEntry({
      action: 'search',
      success: true,
      clusteredResults: {
        categories: { market: [], forum: [], 'link-list': [], news: [], service: [], unknown: [] },
        total: 0,
        presentCategories: [],
        dedupStats: { input: 0, unique: 0, dropped: 0 },
        providersUsed: [],
      },
    }))
    expect(out).not.toContain('Clustered results')
  })
})
