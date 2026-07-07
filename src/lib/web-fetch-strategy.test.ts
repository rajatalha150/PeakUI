import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock playwright-core so the browser path runs against a fake page object
// rather than launching a real Chromium instance.
vi.mock('playwright-core', () => {
  class MockBrowser {
    contexts: MockContext[] = []
    newContext = async () => {
      const ctx = new MockContext()
      this.contexts.push(ctx)
      return ctx
    }
    close = async () => {}
  }
  class MockContext {
    pages: MockPage[] = []
    newPage = async () => {
      const p = new MockPage()
      this.pages.push(p)
      return p
    }
    close = async () => {}
    browser = () => new MockBrowser()
  }
  class MockPage {
    goto = async () => null
    waitForLoadState = async () => null
    waitForTimeout = async () => null
    title = async () => 'Mock Title'
    evaluate = async () => 'Mock rendered text from page body'
    close = async () => {}
    context = () => new MockContext()
    browser = () => new MockBrowser()
    url = () => 'about:blank'
    isClosed = () => false
    bringToFront = async () => {}
  }
  return {
    chromium: {
      launch: async () => new MockBrowser(),
    },
  }
})

// Mock uwaf-pool so the managed-pool path doesn't try to launch Xvfb/Chromium.
vi.mock('./uwaf-pool', () => ({
  getPage: vi.fn().mockRejectedValue(new Error('UWAF pool not available in tests')),
  closeContext: vi.fn().mockResolvedValue(undefined),
}))

// Mock web-context so the fast path can be controlled per-test.
const fetchPublicWebPageMock = vi.fn()
vi.mock('./web-context', () => ({
  fetchPublicWebPage: (...args: unknown[]) => fetchPublicWebPageMock(...args),
}))

describe('web-fetch-strategy', () => {
  beforeEach(() => {
    fetchPublicWebPageMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the fast path when strategy is explicit and does not invoke browser', async () => {
    fetchPublicWebPageMock.mockResolvedValueOnce({
      filename: 'Example',
      title: 'Example Domain',
      url: 'https://example.com',
      excerpt: 'Lots of content here that exceeds the upgrade threshold easily.',
      content: 'Lots of content here that exceeds the upgrade threshold easily.',
      score: 1,
      mode: 'web',
    })
    const { fetchAsReadableText, clearStrategyCache } = await import('./web-fetch-strategy')
    clearStrategyCache()
    const result = await fetchAsReadableText('https://example.com', { strategy: 'fast' })
    expect(result?.title).toBe('Example Domain')
    expect(fetchPublicWebPageMock).toHaveBeenCalledTimes(1)
  })

  it('upgrades to browser when the fast excerpt is short and body is JS-heavy', async () => {
    fetchPublicWebPageMock.mockResolvedValueOnce({
      filename: 'SEC EDGAR',
      title: 'XBRL Viewer',
      url: 'https://www.sec.gov/cgi-bin/viewer?cik=PLTR',
      excerpt: '',
      content: '',
      rawBody: '<html><body><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></body></html>',
      score: 1,
      mode: 'web',
    })
    const { fetchAsReadableText, clearStrategyCache } = await import('./web-fetch-strategy')
    clearStrategyCache()
    const result = await fetchAsReadableText('https://www.sec.gov/cgi-bin/viewer?cik=PLTR')
    expect(result?.title).toBe('Mock Title')
    expect(result?.content).toContain('Mock rendered text')
  }, 30_000)

  it('caches the browser decision so subsequent calls skip the fast path retry', async () => {
    fetchPublicWebPageMock.mockResolvedValueOnce({
      filename: 'Cached',
      title: 'First',
      url: 'https://cached.example/path',
      excerpt: '',
      content: '',
      rawBody: '<html><body><script>console.log("a")</script><script>console.log("b")</script><script>console.log("c")</script></body></html>',
      score: 1,
      mode: 'web',
    })
    const { fetchAsReadableText, clearStrategyCache } = await import('./web-fetch-strategy')
    clearStrategyCache()
    const first = await fetchAsReadableText('https://cached.example/path')
    expect(first?.title).toBe('Mock Title')
    // Second call on the same host should bypass the fast HTTP path entirely.
    fetchPublicWebPageMock.mockClear()
    const second = await fetchAsReadableText('https://cached.example/path')
    expect(second?.title).toBe('Mock Title')
    expect(fetchPublicWebPageMock).not.toHaveBeenCalled()
  }, 30_000)

  it('detects JS-required responses by script tag count and excerpt length', async () => {
    const { responseLooksJsRequired } = await import('./web-fetch-strategy')
    expect(responseLooksJsRequired(
      '<html><body><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></body></html>',
      ''
    )).toBe(true)
    expect(responseLooksJsRequired(
      '<html><body><p>Static article.</p></body></html>',
      'Static article.'
    )).toBe(false)
    expect(responseLooksJsRequired(null, null)).toBe(false)
  })
})
