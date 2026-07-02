import { describe, expect, it } from 'vitest'
import {
  commitObservationToSession,
  getOrCreateSession,
  getUwafBrowserSession,
  recordSearchHistory,
  recordVisitedPage,
  resolveTargetLink,
  updateTabSnapshots,
  type PageObservation,
  type UwafBrowserSession,
} from './uwaf-browser'

const MAX_SESSION_VISITED_PAGES = 50
const MAX_SESSION_SEARCH_HISTORY = 20

function makeSession(overrides: Partial<UwafBrowserSession> = {}): UwafBrowserSession {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    mode: 'direct',
    stealthProfile: 'normal',
    updatedAt: Date.now(),
    currentPage: undefined,
    tabSnapshots: [],
    filledForms: {},
    screenshots: [],
    visitedPages: [],
    searchHistory: [],
    ...overrides,
  }
}

function makeObservation(overrides: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://example.com/page',
    title: 'Example Page',
    text: '',
    html: '',
    markdown: '',
    links: [],
    forms: [],
    tables: [],
    antiBotDetected: false,
    loginDetected: false,
    jsErrors: [],
    networkErrors: [],
    tabs: [{ index: 0, url: 'https://example.com/page', title: 'Example Page', active: true }],
    activeTabIndex: 0,
    pageSignature: 'sig',
    observations: [],
    ...overrides,
  }
}

describe('uwaf browser session memory', () => {
  it('records a visited page', () => {
    const session = makeSession()
    recordVisitedPage(session, { url: 'https://example.com/a', title: 'A', httpStatus: 200 }, 'open')
    expect(session.visitedPages).toHaveLength(1)
    expect(session.visitedPages[0].url).toBe('https://example.com/a')
    expect(session.visitedPages[0].source).toBe('open')
    expect(session.visitedPages[0].mode).toBe('direct')
  })

  it('deduplicates consecutive entries with the same url and source', () => {
    const session = makeSession()
    recordVisitedPage(session, { url: 'https://example.com/a', title: 'A' }, 'open')
    recordVisitedPage(session, { url: 'https://example.com/a', title: 'A' }, 'open')
    recordVisitedPage(session, { url: 'https://example.com/a', title: 'A' }, 'click')
    expect(session.visitedPages).toHaveLength(2)
    expect(session.visitedPages[1].source).toBe('click')
  })

  it('prunes visited pages to the configured maximum', () => {
    const session = makeSession()
    for (let i = 0; i < MAX_SESSION_VISITED_PAGES + 5; i++) {
      recordVisitedPage(session, { url: `https://example.com/${i}`, title: `Page ${i}` }, 'open')
    }
    expect(session.visitedPages).toHaveLength(MAX_SESSION_VISITED_PAGES)
    expect(session.visitedPages[0].url).toBe(`https://example.com/5`)
    expect(session.visitedPages[MAX_SESSION_VISITED_PAGES - 1].url).toBe(
      `https://example.com/${MAX_SESSION_VISITED_PAGES + 4}`,
    )
  })

  it('records search history and prunes to the configured maximum', () => {
    const session = makeSession()
    for (let i = 0; i < MAX_SESSION_SEARCH_HISTORY + 3; i++) {
      recordSearchHistory(session, `query ${i}`, { id: 'engine', label: 'Engine' }, i, true, [
        `https://example.com/${i}`,
      ])
    }
    expect(session.searchHistory).toHaveLength(MAX_SESSION_SEARCH_HISTORY)
    expect(session.searchHistory[0].query).toBe('query 3')
    expect(session.searchHistory[MAX_SESSION_SEARCH_HISTORY - 1].query).toBe(
      `query ${MAX_SESSION_SEARCH_HISTORY + 2}`,
    )
  })

  it('updates tab snapshots and only exposes links/forms on the active tab', () => {
    const session = makeSession()
    const observation = makeObservation({
      tabs: [
        { index: 0, url: 'https://example.com/first', title: 'First', active: false },
        { index: 1, url: 'https://example.com/second', title: 'Second', active: true },
      ],
      activeTabIndex: 1,
      links: [{ index: 0, text: 'link', url: 'https://example.com/second-link' }],
      forms: [{ index: 0, action: 'https://example.com/second-form', method: 'POST', fields: [] }],
    })
    updateTabSnapshots(session, observation)
    expect(session.tabSnapshots).toHaveLength(2)
    expect(session.tabSnapshots[0].links).toHaveLength(0)
    expect(session.tabSnapshots[0].forms).toHaveLength(0)
    expect(session.tabSnapshots[1].links).toHaveLength(1)
    expect(session.tabSnapshots[1].forms).toHaveLength(1)
    expect(session.tabSnapshots[1].active).toBe(true)
  })

  it('commits an observation to session state', () => {
    const session = makeSession()
    const observation = makeObservation({
      url: 'https://example.com/commit',
      title: 'Commit',
      httpStatus: 200,
    })
    const beforeUpdatedAt = session.updatedAt
    commitObservationToSession(session, observation, 'click')
    expect(session.currentPage?.url).toBe('https://example.com/commit')
    expect(session.tabSnapshots).toHaveLength(1)
    expect(session.visitedPages).toHaveLength(1)
    expect(session.visitedPages[0].source).toBe('click')
    expect(session.updatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt)
  })
})

describe('uwaf browser cross-tab link resolution', () => {
  it('resolves a link by index on the current page', async () => {
    const session = makeSession({
      currentPage: {
        url: 'https://example.com',
        title: 'Home',
        links: [
          { index: 0, text: 'One', url: 'https://example.com/one' },
          { index: 1, text: 'Two', url: 'https://example.com/two' },
        ],
        forms: [],
      },
    })
    const url = await resolveTargetLink(session, { action: 'click', sessionId: 'session-1', linkIndex: 1 })
    expect(url).toBe('https://example.com/two')
  })

  it('resolves a link by text across tab snapshots', async () => {
    const session = makeSession({
      currentPage: {
        url: 'https://example.com/active',
        title: 'Active',
        links: [{ index: 0, text: 'Current', url: 'https://example.com/current' }],
        forms: [],
      },
      tabSnapshots: [
        {
          tabIndex: 0,
          url: 'https://example.com/tab0',
          title: 'Tab 0',
          active: false,
          links: [{ index: 0, text: 'Background', url: 'https://example.com/background' }],
          forms: [],
        },
        {
          tabIndex: 1,
          url: 'https://example.com/tab1',
          title: 'Tab 1',
          active: true,
          links: [],
          forms: [],
        },
      ],
    })
    const url = await resolveTargetLink(session, { action: 'click', sessionId: 'session-1', linkText: 'Background' })
    expect(url).toBe('https://example.com/background')
  })

  it('prefers a requested tab snapshot over the current page', async () => {
    const session = makeSession({
      currentPage: {
        url: 'https://example.com/active',
        title: 'Active',
        links: [{ index: 0, text: 'Shared', url: 'https://example.com/active-shared' }],
        forms: [],
      },
      tabSnapshots: [
        {
          tabIndex: 2,
          url: 'https://example.com/tab2',
          title: 'Tab 2',
          active: false,
          links: [{ index: 0, text: 'Shared', url: 'https://example.com/tab2-shared' }],
          forms: [],
        },
      ],
    })
    const url = await resolveTargetLink(session, {
      action: 'click',
      sessionId: 'session-1',
      linkText: 'Shared',
      tabIndex: 2,
    })
    expect(url).toBe('https://example.com/tab2-shared')
  })

  it('throws when a link is not found', async () => {
    const session = makeSession({
      currentPage: {
        url: 'https://example.com',
        title: 'Home',
        links: [],
        forms: [],
      },
    })
    await expect(
      resolveTargetLink(session, { action: 'click', sessionId: 'session-1', linkIndex: 0 }),
    ).rejects.toThrow('Link not found')
  })

  it('retrieves session by key', () => {
    const session = getOrCreateSession('user-1', 'lookup-session', 'direct', 'normal')
    const observation = makeObservation({ url: 'https://example.com/lookup', title: 'Lookup' })
    commitObservationToSession(session, observation, 'open')
    const retrieved = getUwafBrowserSession('user-1', 'lookup-session', 'direct')
    expect(retrieved).toBe(session)
    expect(retrieved?.visitedPages[0].url).toBe('https://example.com/lookup')
  })
})

describe('uwaf browser reopen_recent', () => {
  it('resolves a URL from searchHistory by index', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    const session = makeSession({
      searchHistory: [
        {
          query: 'leaked documents',
          mode: 'stealth',
          providerId: 'ahmia',
          providerLabel: 'Ahmia',
          resultCount: 5,
          success: true,
          topUrls: ['http://a.onion/x', 'http://b.onion/y'],
          searchedAt: new Date().toISOString(),
        },
      ],
    })
    expect(resolveReopenRecentTarget(session, 'search', 0)).toBe('http://a.onion/x')
  })

  it('resolves a URL from tabSnapshots by index', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    const session = makeSession({
      tabSnapshots: [
        { tabIndex: 0, url: 'http://a.onion/x', title: 'A', links: [], forms: [], active: true },
        { tabIndex: 1, url: 'http://b.onion/y', title: 'B', links: [], forms: [], active: false },
      ],
    })
    expect(resolveReopenRecentTarget(session, 'tab', 1)).toBe('http://b.onion/y')
  })

  it('throws when recentKind is missing', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    expect(() => resolveReopenRecentTarget(makeSession(), undefined, 0)).toThrow(/recentKind/)
  })

  it('throws when recentIndex is missing', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    expect(() => resolveReopenRecentTarget(makeSession(), 'search', undefined)).toThrow(/recentIndex/)
  })

  it('throws when the search entry has no top URLs (zero-result search)', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    const session = makeSession({
      searchHistory: [
        {
          query: 'no results',
          mode: 'stealth',
          providerId: 'ahmia',
          providerLabel: 'Ahmia',
          resultCount: 0,
          success: false,
          topUrls: [],
          searchedAt: new Date().toISOString(),
        },
      ],
    })
    expect(() => resolveReopenRecentTarget(session, 'search', 0)).toThrow(/no top result URLs/)
  })

  it('throws when the search index is out of range', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    const session = makeSession({ searchHistory: [] })
    expect(() => resolveReopenRecentTarget(session, 'search', 5)).toThrow(/no search entry/)
  })

  it('throws when the tab index is out of range', async () => {
    const { resolveReopenRecentTarget } = await import('./uwaf-browser')
    const session = makeSession({ tabSnapshots: [] })
    expect(() => resolveReopenRecentTarget(session, 'tab', 5)).toThrow(/no tab entry/)
  })
})
