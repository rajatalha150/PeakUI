import type { BrowserContext, Page } from 'playwright-core'
import { checkOnionResolution, closeContext, getPage, type BrowserMode } from './uwaf-pool'
import { getDefaultStealthProfile, normalizeStealthProfile, type StealthProfile } from './uwaf-fingerprint'
import {
  extractTables,
  isBlockedBinaryUrl,
  sanitizeHtmlToMarkdown,
  type ExtractedTable,
  type SanitizeOptions,
} from './uwaf-sanitizer'
import type { OpenClawUwafBrowserMode } from './settings'
import { assertPublicHttpUrl } from './openclaw-browser'
import { recordUwafPageOpenTime } from './uwaf-telemetry'
import {
  getCuratedStealthEntryPoints,
  getSearchProviderById,
  isStealthProviderId,
  listSearchProviders,
  recordSearchProviderOutcome,
  type UwafSearchAttempt,
  type UwafSearchProvider,
} from './uwaf-search-providers'

const MAX_TEXT_CHARS = 30_000
const MAX_LINKS = 50
const SCREENSHOT_QUALITY = 60
const RESEARCH_BATCH_MAX_DEPTH = 3
const RESEARCH_BATCH_MAX_PAGES = 10
const SESSION_TTL_MS = 60 * 60 * 1000
const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const MAX_WAIT_TIMEOUT_MS = 30_000
const MAX_SCROLL_DELTA = 5_000
const MAX_JS_ERRORS = 8
const MAX_NETWORK_ERRORS = 10
const MAX_DIRECT_SEARCH_PROVIDER_ATTEMPTS = 2
const MAX_STEALTH_SEARCH_PROVIDER_ATTEMPTS = 3
const DIRECT_SEARCH_PROVIDER_TIMEOUT_MS = 18_000
const STEALTH_SEARCH_PROVIDER_TIMEOUT_MS = 22_000

const LOGIN_PATTERNS = [
  /\blog in\b/i,
  /\bsign in\b/i,
  /\bpassword\b/i,
  /\bemail\b/i,
  /\btwo-factor\b/i,
  /\bmfa\b/i,
  /\bone-time code\b/i,
]

const ANTI_BOT_PATTERNS = [
  /\bcaptcha\b/i,
  /\bi am human\b/i,
  /\bverify you are human\b/i,
  /\bcloudflare\b/i,
  /\bchecking your browser\b/i,
  /\baccess denied\b/i,
  /\bautomated requests\b/i,
  /\bsecurity check\b/i,
  /\bpress and hold\b/i,
]

export type UwafFailureCode =
  | 'homepage_bounce'
  | 'search_failed'
  | 'selector_not_found'
  | 'timeout'
  | 'no_effect'
  | 'anti_bot_detected'
  | 'login_required'
  | 'navigation_blocked'
  | 'binary_blocked'
  | 'tor_unavailable'
  | 'page_unavailable'
  | 'invalid_request'
  | 'unsupported_action'

export type UwafAction =
  | 'search'
  | 'open'
  | 'click'
  | 'type'
  | 'press'
  | 'wait_for_selector'
  | 'scroll'
  | 'back'
  | 'forward'
  | 'new_tab'
  | 'list_tabs'
  | 'switch_tab'
  | 'close_tab'
  | 'select'
  | 'hover'
  | 'extract_table'
  | 'research_batch'
  | 'fill'
  | 'submit'
  | 'extract'
  | 'wait_for_user'

export interface UwafBrowserRequest {
  action: UwafAction
  sessionId: string
  query?: string
  providerId?: string
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  browserMode?: BrowserMode
  stealthProfile?: StealthProfile
  depth?: number
  selector?: string
  text?: string
  key?: string
  tabIndex?: number
  timeoutMs?: number
  deltaY?: number
  optionValue?: string
  optionLabel?: string
}

export interface UwafBrowserLink {
  index: number
  text: string
  url: string
}

export interface UwafBrowserFormField {
  name: string
  type: string
  value?: string
}

export interface UwafBrowserForm {
  index: number
  action: string
  method: 'GET' | 'POST'
  fields: UwafBrowserFormField[]
}

export interface UwafBrowserTab {
  index: number
  url: string
  title: string
  active: boolean
}

export interface UwafBrowserResult {
  action: UwafAction
  currentUrl: string
  title: string
  text: string
  markdown?: string
  html?: string
  links: UwafBrowserLink[]
  forms: UwafBrowserForm[]
  tables?: ExtractedTable[]
  screenshot?: string
  mode: BrowserMode
  stealthProfile?: StealthProfile
  source?: 'clear_web' | 'dark_web'
  success: boolean
  error?: string
  pendingFormValues?: Record<string, string>
  submitted?: {
    url: string
    method: 'GET' | 'POST'
    fieldCount: number
  }
  batchResults?: UwafBatchResult[]
  requestedUrl?: string
  requestedQuery?: string
  finalUrl?: string
  redirected?: boolean
  httpStatus?: number
  queryMatched?: boolean
  resultCount?: number
  antiBotDetected?: boolean
  loginDetected?: boolean
  jsErrors?: string[]
  networkErrors?: string[]
  failureCode?: UwafFailureCode
  failureDetail?: string
  pageChanged?: boolean
  navigationChanged?: boolean
  selectorMatched?: boolean
  waitTimedOut?: boolean
  searchEngine?: string
  searchProviderId?: string
  searchAttempts?: UwafSearchAttempt[]
  tabs?: UwafBrowserTab[]
  activeTabIndex?: number
  observations?: string[]
}

export interface UwafBatchResult {
  url: string
  title: string
  markdown: string
  links: UwafBrowserLink[]
  depth: number
}

export interface UwafBrowserSettings {
  openClawUwafBrowserMode: OpenClawUwafBrowserMode
  openClawUwafScreenshots: boolean
  openClawUwafDefaultMode: BrowserMode
}

const MAX_SESSION_SCREENSHOTS = 20

interface UwafBrowserSession {
  userId: string
  sessionId: string
  mode: BrowserMode
  stealthProfile: StealthProfile
  updatedAt: number
  currentPage?: {
    url: string
    title: string
    links: UwafBrowserLink[]
    forms: UwafBrowserForm[]
  }
  filledForms: Record<number, Record<string, string>>
  screenshots: string[]
}

interface PageEventRecord {
  timestamp: number
  message: string
}

interface PageInstrumentation {
  jsErrors: PageEventRecord[]
  networkErrors: PageEventRecord[]
}

interface PageObservation {
  url: string
  title: string
  text: string
  html: string
  markdown: string
  links: UwafBrowserLink[]
  forms: UwafBrowserForm[]
  tables: ExtractedTable[]
  screenshot?: string
  httpStatus?: number
  redirected?: boolean
  antiBotDetected: boolean
  loginDetected: boolean
  jsErrors: string[]
  networkErrors: string[]
  tabs: UwafBrowserTab[]
  activeTabIndex: number
  pageSignature: string
  observations: string[]
  stealthProfile?: StealthProfile
}

const sessions = new Map<string, UwafBrowserSession>()
const pageInstrumentation = new WeakMap<Page, PageInstrumentation>()

export function resolveStealthProfileForRequest(
  request: Pick<UwafBrowserRequest, 'action' | 'url' | 'query' | 'stealthProfile'>,
  defaultProfile: StealthProfile = getDefaultStealthProfile(),
): StealthProfile {
  if (request.stealthProfile) {
    return normalizeStealthProfile(request.stealthProfile)
  }

  const raw = `${request.url || ''} ${request.query || ''}`.toLowerCase()
  const likelySensitive = raw.includes('.onion')
    || raw.includes('hidden service')
    || raw.includes('high stealth')
    || raw.includes('high-stealth')
    || request.action === 'research_batch'

  return likelySensitive ? 'high' : normalizeStealthProfile(defaultProfile)
}

function getSessionKey(userId: string, sessionId: string, mode: BrowserMode): string {
  return `${userId}:${sessionId}:${mode}`
}

function getOrCreateSession(
  userId: string,
  sessionId: string,
  mode: BrowserMode,
  stealthProfile: StealthProfile,
): UwafBrowserSession {
  cleanupExpiredSessions()
  const key = getSessionKey(userId, sessionId, mode)
  const existing = sessions.get(key)
  if (existing && Date.now() - existing.updatedAt < SESSION_TTL_MS) {
    existing.updatedAt = Date.now()
    existing.stealthProfile = stealthProfile
    return existing
  }

  const session: UwafBrowserSession = {
    userId,
    sessionId,
    mode,
    stealthProfile,
    updatedAt: Date.now(),
    filledForms: {},
    screenshots: [],
  }
  sessions.set(key, session)
  return session
}

function pushScreenshot(session: UwafBrowserSession, screenshot: string | undefined): void {
  if (!screenshot) return
  session.screenshots.push(screenshot)
  if (session.screenshots.length > MAX_SESSION_SCREENSHOTS) {
    session.screenshots = session.screenshots.slice(-MAX_SESSION_SCREENSHOTS)
  }
}

function cleanupExpiredSessions(): void {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(key)
      closeContext(key).catch(() => {})
    }
  }
}

function getSourceMode(mode: BrowserMode): 'clear_web' | 'dark_web' {
  return mode === 'stealth' ? 'dark_web' : 'clear_web'
}

function normalizeWaitTimeout(timeoutMs: number | undefined): number {
  if (!timeoutMs || !Number.isFinite(timeoutMs)) {
    return DEFAULT_WAIT_TIMEOUT_MS
  }
  return Math.max(500, Math.min(Math.trunc(timeoutMs), MAX_WAIT_TIMEOUT_MS))
}

function normalizeDeltaY(deltaY: number | undefined): number {
  if (!Number.isFinite(deltaY)) return 800
  return Math.max(-MAX_SCROLL_DELTA, Math.min(Math.trunc(deltaY as number), MAX_SCROLL_DELTA))
}

function isOnionUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.onion')
  } catch {
    return false
  }
}

function isValidOnionHostname(hostname: string): boolean {
  const label = hostname.toLowerCase().replace(/\.onion$/, '')
  return /^[a-z2-7]{56}$/.test(label) || /^[a-z2-7]{16}$/.test(label)
}

function describeOnionValidationIssue(hostname: string): string {
  const label = hostname.toLowerCase().replace(/\.onion$/, '')
  if (label.length !== 16 && label.length !== 56) {
    return `onion address length is ${label.length}; valid v2 addresses are 16 chars and v3 addresses are 56 chars`
  }
  const invalidChars = Array.from(new Set(label.match(/[^a-z2-7]/g) || []))
  return `onion address contains invalid characters: ${invalidChars.join(', ')}; only a-z and 2-7 are allowed`
}

async function assertUwafUrlAllowed(rawUrl: string, mode: BrowserMode): Promise<URL> {
  if (isOnionUrl(rawUrl)) {
    if (mode !== 'stealth') {
      throw new Error(`.onion URLs are only accessible in Stealth (Tor) mode. Switch to Stealth mode to access: ${rawUrl}`)
    }

    let onionUrl: URL
    try {
      onionUrl = new URL(rawUrl)
    } catch {
      throw new Error(`Invalid URL: ${rawUrl}`)
    }

    if (!['http:', 'https:'].includes(onionUrl.protocol)) {
      throw new Error(`Blocked non-web URL: ${onionUrl.href}`)
    }

    if (onionUrl.username || onionUrl.password) {
      throw new Error(`Blocked credentialed URL: ${onionUrl.href}`)
    }

    if (onionUrl.port && !['80', '443'].includes(onionUrl.port)) {
      throw new Error(`Blocked non-standard port for URL: ${onionUrl.href}`)
    }

    if (!isValidOnionHostname(onionUrl.hostname)) {
      throw new Error(`Invalid .onion hostname. Expected a valid v2/v3 onion address, got: ${onionUrl.hostname} (${describeOnionValidationIssue(onionUrl.hostname)}).`)
    }

    return onionUrl
  }

  return await assertPublicHttpUrl(rawUrl)
}

function pushPageEvent(target: PageEventRecord[], message: string, limit: number): void {
  target.push({ timestamp: Date.now(), message: message.slice(0, 240) })
  if (target.length > limit) {
    target.splice(0, target.length - limit)
  }
}

function ensurePageInstrumentation(page: Page): PageInstrumentation {
  const existing = pageInstrumentation.get(page)
  if (existing) {
    return existing
  }

  const instrumentation: PageInstrumentation = {
    jsErrors: [],
    networkErrors: [],
  }

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      pushPageEvent(instrumentation.jsErrors, `[console:${message.type()}] ${message.text()}`, MAX_JS_ERRORS)
    }
  })

  page.on('pageerror', (error) => {
    pushPageEvent(instrumentation.jsErrors, `[pageerror] ${error.message}`, MAX_JS_ERRORS)
  })

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'request failed'
    pushPageEvent(instrumentation.networkErrors, `${request.method()} ${request.url()} -> ${failureText}`, MAX_NETWORK_ERRORS)
  })

  page.on('response', (response) => {
    if (response.status() >= 400) {
      pushPageEvent(
        instrumentation.networkErrors,
        `${response.request().method()} ${response.url()} -> HTTP ${response.status()}`,
        MAX_NETWORK_ERRORS,
      )
    }
  })

  pageInstrumentation.set(page, instrumentation)
  return instrumentation
}

function getRecentPageEvents(page: Page, since: number): { jsErrors: string[]; networkErrors: string[] } {
  const instrumentation = ensurePageInstrumentation(page)
  return {
    jsErrors: instrumentation.jsErrors.filter(item => item.timestamp >= since).map(item => item.message),
    networkErrors: instrumentation.networkErrors.filter(item => item.timestamp >= since).map(item => item.message),
  }
}

function extractLinksFromPage(page: Page): Promise<UwafBrowserLink[]> {
  return page.evaluate((maxLinks: number) => {
    const links: { index: number; text: string; url: string }[] = []
    const anchors = document.querySelectorAll('a[href]')
    for (let i = 0; i < anchors.length && links.length < maxLinks; i += 1) {
      const anchor = anchors[i] as HTMLAnchorElement
      const href = anchor.href
      if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('mailto:')) continue
      const text = (anchor.textContent || '').trim().slice(0, 200)
      if (!text) continue
      links.push({ index: links.length, text, url: href })
    }
    return links
  }, MAX_LINKS)
}

function extractFormsFromPage(page: Page): Promise<UwafBrowserForm[]> {
  return page.evaluate<UwafBrowserForm[], number>((maxForms: number) => {
    const forms: UwafBrowserForm[] = []
    const formElements = document.querySelectorAll('form')
    for (let i = 0; i < formElements.length && forms.length < maxForms; i += 1) {
      const form = formElements[i] as HTMLFormElement
      const fields: UwafBrowserFormField[] = []
      const inputs = form.querySelectorAll('input, textarea, select')
      for (let j = 0; j < inputs.length && fields.length < 30; j += 1) {
        const input = inputs[j] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        const name = input.getAttribute('name') || input.id || `field_${j}`
        const type = input.getAttribute('type')
          || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName === 'SELECT' ? 'select' : 'text')
        const value = input.getAttribute('value') || ''
        fields.push({ name, type, value })
      }
      const normalizedMethod = (form.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
      forms.push({
        index: i,
        action: form.action || window.location.href,
        method: normalizedMethod,
        fields,
      })
    }
    return forms
  }, 10)
}

async function captureScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: SCREENSHOT_QUALITY,
      fullPage: false,
    })
    return Buffer.from(buffer).toString('base64')
  } catch {
    return undefined
  }
}

async function listTabs(context: BrowserContext, activePage: Page): Promise<{ tabs: UwafBrowserTab[]; activeTabIndex: number }> {
  const pages = context.pages().filter(page => !page.isClosed())
  const tabs = await Promise.all(
    pages.map(async (page, index) => ({
      index,
      url: page.url(),
      title: await page.title().catch(() => ''),
      active: page === activePage,
    })),
  )

  const activeTabIndex = Math.max(0, tabs.findIndex(tab => tab.active))
  return { tabs, activeTabIndex }
}

function detectLoginRequirement(title: string, markdown: string, forms: UwafBrowserForm[]): boolean {
  if (forms.some(form => form.fields.some(field => field.type === 'password'))) {
    return true
  }

  const haystack = `${title}\n${markdown.slice(0, 4_000)}`
  return LOGIN_PATTERNS.some(pattern => pattern.test(haystack))
}

function detectAntiBot(title: string, markdown: string, networkErrors: string[], jsErrors: string[]): boolean {
  const haystack = `${title}\n${markdown.slice(0, 4_000)}\n${networkErrors.join('\n')}\n${jsErrors.join('\n')}`
  return ANTI_BOT_PATTERNS.some(pattern => pattern.test(haystack))
}

function buildPageSignature(title: string, markdown: string, links: UwafBrowserLink[], forms: UwafBrowserForm[]): string {
  return [
    title,
    markdown.slice(0, 1_500),
    links.slice(0, 10).map(link => `${link.text}|${link.url}`).join('\n'),
    forms.slice(0, 5).map(form => `${form.method}|${form.action}|${form.fields.map(field => field.name).join(',')}`).join('\n'),
  ].join('\n--\n')
}

async function syncSessionCurrentPage(session: UwafBrowserSession, page: Page): Promise<void> {
  await page.bringToFront().catch(() => {})
  const [title, links, forms] = await Promise.all([
    page.title().catch(() => ''),
    extractLinksFromPage(page),
    extractFormsFromPage(page),
  ])

  session.currentPage = {
    url: page.url(),
    title,
    links,
    forms,
  }
}

async function observePage(
  page: Page,
  mode: BrowserMode,
  takeScreenshot: boolean,
  options: {
    requestUrl?: string
    httpStatus?: number
    redirected?: boolean
    since?: number
    observations?: string[]
    stealthProfile?: StealthProfile
  } = {},
): Promise<PageObservation> {
  ensurePageInstrumentation(page)

  await page.bringToFront().catch(() => {})
  await page.waitForTimeout(400)

  const currentUrl = page.url()
  const title = await page.title().catch(() => '')
  const html = await page.content().catch(() => '')

  const contentType = await page.evaluate(() => document.contentType || '').catch(() => '')
  if (isBlockedBinaryUrl(currentUrl, contentType)) {
    throw new Error('Blocked: This page appears to serve an executable file. Downloading binaries requires explicit unpacking approval.')
  }

  const sanitizeOpts: SanitizeOptions = {
    strict: mode === 'stealth',
    maxTextLength: MAX_TEXT_CHARS,
    preserveTables: true,
  }

  const markdown = sanitizeHtmlToMarkdown(html, sanitizeOpts)
  const text = markdown.slice(0, MAX_TEXT_CHARS)
  const [links, forms, tabsState, screenshot] = await Promise.all([
    extractLinksFromPage(page),
    extractFormsFromPage(page),
    listTabs(page.context(), page),
    takeScreenshot ? captureScreenshot(page) : Promise.resolve(undefined),
  ])
  const tables = extractTables(html)
  const events = getRecentPageEvents(page, options.since || 0)
  const loginDetected = detectLoginRequirement(title, markdown, forms)
  const antiBotDetected = detectAntiBot(title, markdown, events.networkErrors, events.jsErrors)
  const observations = [...(options.observations || [])]

  if (options.requestUrl && currentUrl !== options.requestUrl) {
    observations.push(`Navigation ended at ${currentUrl} instead of the requested URL.`)
  }
  if (antiBotDetected) {
    observations.push('The page appears to contain anti-bot or human-verification friction.')
  }
  if (loginDetected) {
    observations.push('The observed page appears to require authentication or user credentials.')
  }

  return {
    url: currentUrl,
    title,
    text,
    html: html.slice(0, 20_000),
    markdown,
    links,
    forms,
    tables,
    screenshot,
    httpStatus: options.httpStatus,
    redirected: options.redirected,
    antiBotDetected,
    loginDetected,
    jsErrors: events.jsErrors,
    networkErrors: events.networkErrors,
    tabs: tabsState.tabs,
    activeTabIndex: tabsState.activeTabIndex,
    pageSignature: buildPageSignature(title, markdown, links, forms),
    observations,
    stealthProfile: options.stealthProfile,
  }
}

async function countMatchingSelectors(page: Page, selectors: readonly string[]): Promise<number> {
  for (const selector of selectors) {
    const count = await page.locator(selector).count().catch(() => 0)
    if (count > 0) {
      return count
    }
  }
  return 0
}

async function waitForMatchingSelectors(page: Page, selectors: readonly string[], timeoutMs = 5000): Promise<boolean> {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { state: 'attached', timeout: timeoutMs })
      return true
    } catch {
      // Try the next selector.
    }
  }
  return false
}

async function maybeUseSearchForm(page: Page, provider: UwafSearchProvider, query: string): Promise<boolean> {
  await page.goto(provider.homeUrl, { timeout: 30_000, waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(250)

  for (const selector of provider.inputSelectors) {
    const locator = page.locator(selector).first()
    const count = await locator.count().catch(() => 0)
    if (count === 0) continue

    await locator.fill(query).catch(() => {})
    await locator.press('Enter').catch(() => {})
    for (const submitSelector of provider.submitSelectors) {
      const button = page.locator(submitSelector).first()
      const buttonCount = await button.count().catch(() => 0)
      if (buttonCount > 0) {
        await button.click().catch(() => {})
        break
      }
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
    // JS-heavy engines (OnionLand, TorDex, etc.) render results after the
    // initial DOM event. Wait for a result selector before declaring success.
    await waitForMatchingSelectors(page, provider.resultSelectors, 5000)
    return true
  }

  return false
}

function isSearchHomepage(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.pathname === '/' || parsed.pathname === ''
  } catch {
    return false
  }
}

function evaluateSearchObservation(
  observation: PageObservation,
  query: string,
  provider: UwafSearchProvider,
  resultCount: number,
): {
  success: boolean
  queryMatched: boolean
  failureCode?: UwafFailureCode
  failureDetail?: string
  observations: string[]
} {
  const queryTokens = query
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)

  const lowerUrl = observation.url.toLowerCase()
  const lowerTitle = observation.title.toLowerCase()
  const lowerText = observation.markdown.toLowerCase()

  const matchedTokens = queryTokens.filter(token =>
    lowerUrl.includes(token) || lowerTitle.includes(token) || lowerText.includes(token),
  )
  const queryMatched = queryTokens.length === 0 || matchedTokens.length >= Math.max(1, Math.ceil(queryTokens.length / 2))
  const notes = [...observation.observations]

  if (observation.antiBotDetected) {
    return {
      success: false,
      queryMatched,
      failureCode: 'anti_bot_detected',
      failureDetail: 'The search page presented a CAPTCHA, verification gate, or bot defense.',
      observations: notes,
    }
  }

  if (observation.loginDetected) {
    return {
      success: false,
      queryMatched,
      failureCode: 'login_required',
      failureDetail: 'The search flow redirected to a login or credential gate.',
      observations: notes,
    }
  }

  if (resultCount === 0) {
    notes.push('No search-result elements were detected on the page.')
  }

  if (isSearchHomepage(observation.url) && resultCount === 0) {
    return {
      success: false,
      queryMatched,
      failureCode: 'homepage_bounce',
      failureDetail: `${provider.label} returned its home page instead of a result set.`,
      observations: notes,
    }
  }

  if (!queryMatched) {
    return {
      success: false,
      queryMatched,
      failureCode: 'search_failed',
      failureDetail: 'The final page does not reflect the requested query strongly enough to trust the result.',
      observations: notes,
    }
  }

  if (resultCount === 0) {
    return {
      success: false,
      queryMatched,
      failureCode: 'search_failed',
      failureDetail: 'The page loaded, but no usable search results were detected.',
      observations: notes,
    }
  }

  return {
    success: true,
    queryMatched,
    observations: notes,
  }
}

function toResult(
  action: UwafAction,
  mode: BrowserMode,
  observation: PageObservation,
  options: {
    success?: boolean
    error?: string
    requestedUrl?: string
    requestedQuery?: string
    queryMatched?: boolean
    resultCount?: number
    failureCode?: UwafFailureCode
    failureDetail?: string
    pageChanged?: boolean
    navigationChanged?: boolean
    selectorMatched?: boolean
    waitTimedOut?: boolean
    searchEngine?: string
    searchProviderId?: string
    searchAttempts?: UwafSearchAttempt[]
    pendingFormValues?: Record<string, string>
    submitted?: { url: string; method: 'GET' | 'POST'; fieldCount: number }
    batchResults?: UwafBatchResult[]
    textOverride?: string
  } = {},
): UwafBrowserResult {
  return {
    action,
    currentUrl: observation.url,
    title: observation.title,
    text: options.textOverride ?? observation.text,
    markdown: observation.markdown,
    html: observation.html,
    links: observation.links,
    forms: observation.forms,
    tables: observation.tables,
    screenshot: observation.screenshot,
    mode,
    stealthProfile: mode === 'stealth' ? observation.stealthProfile : undefined,
    source: getSourceMode(mode),
    success: options.success ?? true,
    error: options.error,
    requestedUrl: options.requestedUrl,
    requestedQuery: options.requestedQuery,
    finalUrl: observation.url,
    redirected: observation.redirected,
    httpStatus: observation.httpStatus,
    queryMatched: options.queryMatched,
    resultCount: options.resultCount,
    antiBotDetected: observation.antiBotDetected,
    loginDetected: observation.loginDetected,
    jsErrors: observation.jsErrors,
    networkErrors: observation.networkErrors,
    failureCode: options.failureCode,
    failureDetail: options.failureDetail,
    pageChanged: options.pageChanged,
    navigationChanged: options.navigationChanged,
    selectorMatched: options.selectorMatched,
    waitTimedOut: options.waitTimedOut,
    searchEngine: options.searchEngine,
    searchProviderId: options.searchProviderId,
    searchAttempts: options.searchAttempts,
    pendingFormValues: options.pendingFormValues,
    submitted: options.submitted,
    batchResults: options.batchResults,
    tabs: observation.tabs,
    activeTabIndex: observation.activeTabIndex,
    observations: observation.observations,
  }
}

async function resolveTargetLink(session: UwafBrowserSession, request: UwafBrowserRequest): Promise<string> {
  if (!session.currentPage) {
    throw new Error('No page is currently open. Use "open" first.')
  }

  if (request.linkIndex !== undefined && request.linkIndex >= 0 && request.linkIndex < session.currentPage.links.length) {
    return session.currentPage.links[request.linkIndex].url
  }

  if (request.linkText) {
    const lowered = request.linkText.toLowerCase()
    const link = session.currentPage.links.find(item => item.text.toLowerCase().includes(lowered))
    if (link) {
      return link.url
    }
  }

  throw new Error(`Link not found. Available links: 0–${session.currentPage.links.length - 1}`)
}

async function navigateToUrl(
  page: Page,
  url: string,
  mode: BrowserMode,
  takeScreenshot: boolean,
  options: { since?: number; observations?: string[]; stealthProfile?: StealthProfile; timeoutMs?: number } = {},
): Promise<PageObservation> {
  const targetUrl = await assertUwafUrlAllowed(url, mode)
  const observations = [...(options.observations || [])]

  if (isOnionUrl(targetUrl.href)) {
    observations.push(`Attempting .onion navigation through Tor for ${targetUrl.hostname}.`)
  }

  if (isBlockedBinaryUrl(targetUrl.href)) {
    throw new Error('Blocked: URLs pointing to executable files are not allowed for security reasons. If you need this file, request manual unpacking approval.')
  }

  await page.bringToFront().catch(() => {})
  const navigationStartedAt = Date.now()
  let response: Awaited<ReturnType<Page['goto']>>
  try {
    response = await page.goto(targetUrl.href, { timeout: options.timeoutMs ?? 30_000, waitUntil: 'domcontentloaded' })
  } catch (error) {
    if (isOnionUrl(targetUrl.href)) {
      const onionCheck = await checkOnionResolution(targetUrl.href, options.stealthProfile || getDefaultStealthProfile())
      throw new Error(`.onion navigation failed for ${targetUrl.hostname}: ${onionCheck.error || (error instanceof Error ? error.message : String(error))}`)
    }
    throw error
  }
  recordUwafPageOpenTime(Date.now() - navigationStartedAt)
  await page.bringToFront().catch(() => {})

  return await observePage(page, mode, takeScreenshot, {
    requestUrl: targetUrl.href,
    httpStatus: response?.status(),
    redirected: page.url() !== targetUrl.href,
    since: options.since,
    observations,
    stealthProfile: options.stealthProfile,
  })
}

async function executeSearch(
  page: Page,
  query: string,
  mode: BrowserMode,
  takeScreenshot: boolean,
  stealthProfile: StealthProfile,
  preferredProviderId?: string,
): Promise<UwafBrowserResult> {
  if (preferredProviderId) {
    const knownProvider = getSearchProviderById(mode, preferredProviderId)
    if (!knownProvider) {
      const availableProviders = listSearchProviders(mode, query, stealthProfile).map(provider => provider.id).join(', ')
      const message = mode === 'stealth' && isStealthProviderId(preferredProviderId)
        ? `Stealth search provider "${preferredProviderId}" is currently not configured in this deployment. Available providers: ${availableProviders || 'none'}.`
        : `Search provider "${preferredProviderId}" is not available for ${mode} mode. Available providers: ${availableProviders || 'none'}.`
      throw new Error(message)
    }
  }

  const maxProviderAttempts = preferredProviderId
    ? 1
    : mode === 'stealth'
      ? MAX_STEALTH_SEARCH_PROVIDER_ATTEMPTS
      : MAX_DIRECT_SEARCH_PROVIDER_ATTEMPTS
  const providers = listSearchProviders(mode, query, stealthProfile, preferredProviderId).slice(0, maxProviderAttempts)
  const providerTimeoutMs = mode === 'stealth'
    ? STEALTH_SEARCH_PROVIDER_TIMEOUT_MS
    : DIRECT_SEARCH_PROVIDER_TIMEOUT_MS
  const curatedEntryPoints = mode === 'stealth' ? getCuratedStealthEntryPoints() : []
  const attempts: Array<{
    provider: UwafSearchProvider
    observation: PageObservation
    evaluation: ReturnType<typeof evaluateSearchObservation>
    resultCount: number
    requestedUrl: string
  }> = []

  for (const provider of providers) {
    const startedAt = Date.now()
    const requestedUrl = provider.resultsUrl(query)
    let observation = await navigateToUrl(page, requestedUrl, mode, takeScreenshot, {
      since: startedAt,
      stealthProfile,
      timeoutMs: providerTimeoutMs,
      observations: [
        `Issued a ${provider.label} query for: ${query}`,
        ...(curatedEntryPoints.length > 0 && mode === 'stealth'
          ? [`Approved stealth search providers: ${providers.map(entry => entry.label).join(', ')}`]
          : []),
      ],
    })
    // Many search engines render results via JS. Give their result selectors a
    // short window to appear before evaluating the page.
    await waitForMatchingSelectors(page, provider.resultSelectors, 5000)
    let resultCount = await countMatchingSelectors(page, provider.resultSelectors)
    let evaluation = evaluateSearchObservation(observation, query, provider, resultCount)

    if (!evaluation.success) {
      const usedForm = await maybeUseSearchForm(page, provider, query).catch(() => false)
      if (usedForm) {
        observation = await observePage(page, mode, takeScreenshot, {
          since: startedAt,
          observations: [...evaluation.observations, `Retried the query through the ${provider.label} on-page search form.`],
          stealthProfile,
        })
        resultCount = await countMatchingSelectors(page, provider.resultSelectors)
        evaluation = evaluateSearchObservation(observation, query, provider, resultCount)
      }
    }

    recordSearchProviderOutcome({
      providerId: provider.id,
      mode,
      durationMs: Date.now() - startedAt,
      success: evaluation.success,
      antiBotDetected: observation.antiBotDetected,
      loginDetected: observation.loginDetected,
      resultCount,
      useful: evaluation.success && resultCount > 0 && evaluation.queryMatched,
      error: evaluation.failureDetail,
    })

    attempts.push({
      provider,
      observation,
      evaluation,
      resultCount,
      requestedUrl,
    })

    if (evaluation.success) {
      const searchAttempts = attempts.map(entry => ({
        providerId: entry.provider.id,
        providerLabel: entry.provider.label,
        success: entry.evaluation.success,
        resultCount: entry.resultCount,
        queryMatched: entry.evaluation.queryMatched,
        failureCode: entry.evaluation.failureCode,
        failureDetail: entry.evaluation.failureDetail,
      }))
      return toResult('search', mode, observation, {
        success: true,
        requestedUrl,
        requestedQuery: query,
        queryMatched: evaluation.queryMatched,
        resultCount,
        searchEngine: provider.label,
        searchProviderId: provider.id,
        searchAttempts,
      })
    }
  }

  const fallback = attempts.sort((left, right) => {
    if (left.resultCount !== right.resultCount) return right.resultCount - left.resultCount
    if (left.evaluation.queryMatched !== right.evaluation.queryMatched) return left.evaluation.queryMatched ? -1 : 1
    return left.observation.observations.length - right.observation.observations.length
  })[0]

  if (!fallback) {
    throw new Error('No configured search providers are available for this browser mode.')
  }

  return toResult('search', mode, fallback.observation, {
    success: false,
    error: fallback.evaluation.failureDetail,
    requestedUrl: fallback.requestedUrl,
    requestedQuery: query,
    queryMatched: fallback.evaluation.queryMatched,
    resultCount: fallback.resultCount,
    failureCode: fallback.evaluation.failureCode,
    failureDetail: fallback.evaluation.failureDetail,
    searchEngine: fallback.provider.label,
    searchProviderId: fallback.provider.id,
    searchAttempts: attempts.map(entry => ({
      providerId: entry.provider.id,
      providerLabel: entry.provider.label,
      success: entry.evaluation.success,
      resultCount: entry.resultCount,
      queryMatched: entry.evaluation.queryMatched,
      failureCode: entry.evaluation.failureCode,
      failureDetail: entry.evaluation.failureDetail,
    })),
  })
}

async function openNewTabFromUrl(
  page: Page,
  url: string,
  mode: BrowserMode,
  takeScreenshot: boolean,
  since: number,
  stealthProfile: StealthProfile,
): Promise<PageObservation> {
  const targetUrl = await assertUwafUrlAllowed(url, mode)
  const observations: string[] = []
  if (isOnionUrl(targetUrl.href)) {
    observations.push(`Attempting .onion navigation through Tor for ${targetUrl.hostname}.`)
  }
  const nextPage = await page.context().newPage()
  await nextPage.bringToFront().catch(() => {})
  const navigationStartedAt = Date.now()
  let response: Awaited<ReturnType<Page['goto']>>
  try {
    response = await nextPage.goto(targetUrl.href, { timeout: 30_000, waitUntil: 'domcontentloaded' })
  } catch (error) {
    if (isOnionUrl(targetUrl.href)) {
      const onionCheck = await checkOnionResolution(targetUrl.href, stealthProfile)
      throw new Error(`.onion navigation failed for ${targetUrl.hostname}: ${onionCheck.error || (error instanceof Error ? error.message : String(error))}`)
    }
    throw error
  }
  recordUwafPageOpenTime(Date.now() - navigationStartedAt)
  return await observePage(nextPage, mode, takeScreenshot, {
    requestUrl: targetUrl.href,
    httpStatus: response?.status(),
    redirected: nextPage.url() !== targetUrl.href,
    since,
    observations,
    stealthProfile,
  })
}

export async function runUwafBrowserAction(
  userId: string,
  request: UwafBrowserRequest,
  settings: UwafBrowserSettings,
): Promise<UwafBrowserResult> {
  const { openClawUwafBrowserMode } = settings
  if (openClawUwafBrowserMode === 'deny') {
    throw new Error('UWAF browser is disabled. Enable it in Settings to use web browsing.')
  }

  if (!request.sessionId) {
    throw new Error('Session ID is required for UWAF browser actions.')
  }

  const mode: BrowserMode = request.browserMode || settings.openClawUwafDefaultMode || 'direct'
  const stealthProfile = resolveStealthProfileForRequest(request, getDefaultStealthProfile())

  const session = getOrCreateSession(userId, request.sessionId, mode, stealthProfile)
  const takeScreenshot = false
  const contextKey = getSessionKey(userId, request.sessionId, mode)
  const page = await getPage(contextKey, mode, stealthProfile)
  ensurePageInstrumentation(page)

  switch (request.action) {
    case 'search': {
      if (!request.query?.trim()) throw new Error('Query is required for the "search" action.')
      const result = await executeSearch(page, request.query, mode, takeScreenshot, stealthProfile, request.providerId)
      session.currentPage = {
        url: result.currentUrl,
        title: result.title,
        links: result.links,
        forms: result.forms,
      }
      if (result.screenshot) pushScreenshot(session, result.screenshot)
      return result
    }

    case 'open': {
      if (!request.url) throw new Error('URL is required for the "open" action.')
      const since = Date.now()
      const beforeUrl = page.url()
      const beforeSignature = await page.title().catch(() => '')
      const observation = await navigateToUrl(page, request.url, mode, takeScreenshot, { since, stealthProfile })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      if (observation.screenshot) pushScreenshot(session, observation.screenshot)
      return toResult('open', mode, observation, {
        requestedUrl: request.url,
        pageChanged: observation.pageSignature !== beforeSignature,
        navigationChanged: observation.url !== beforeUrl,
      })
    }

    case 'click': {
      await syncSessionCurrentPage(session, page)
      const targetUrl = await resolveTargetLink(session, request)
      const since = Date.now()
      const beforeUrl = page.url()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      const observation = await navigateToUrl(page, targetUrl, mode, takeScreenshot, { since, stealthProfile })
      session.currentPage = { url: observation.url, title: observation.title, links: observation.links, forms: observation.forms }
      if (observation.screenshot) pushScreenshot(session, observation.screenshot)
      return toResult('click', mode, observation, {
        requestedUrl: targetUrl,
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
        navigationChanged: observation.url !== beforeUrl,
      })
    }

    case 'extract': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')
      const observation = await observePage(page, mode, takeScreenshot)
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      const extractMode = request.mode || 'summary'
      const result = toResult('extract', mode, observation)
      if (extractMode === 'links') {
        result.text = ''
        result.markdown = undefined
      } else if (extractMode === 'forms') {
        result.text = ''
        result.markdown = undefined
      } else if (extractMode === 'html') {
        result.text = observation.text
      }
      return result
    }

    case 'extract_table': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')
      const observation = await observePage(page, mode, takeScreenshot)
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('extract_table', mode, observation, {
        textOverride: observation.tables.map(table => table.markdown).join('\n\n'),
      })
    }

    case 'research_batch': {
      if (!request.url) throw new Error('URL is required for "research_batch" action.')
      const depth = Math.min(Math.max(request.depth || 1, 1), RESEARCH_BATCH_MAX_DEPTH)
      const since = Date.now()
      const startObservation = await navigateToUrl(page, request.url, mode, takeScreenshot, { since, stealthProfile })
      const visited = new Set<string>([startObservation.url])
      const results: UwafBatchResult[] = [{
        url: startObservation.url,
        title: startObservation.title,
        markdown: startObservation.markdown.slice(0, MAX_TEXT_CHARS),
        links: startObservation.links,
        depth: 0,
      }]

      session.currentPage = {
        url: startObservation.url,
        title: startObservation.title,
        links: startObservation.links,
        forms: startObservation.forms,
      }
      if (startObservation.screenshot) pushScreenshot(session, startObservation.screenshot)

      let currentLinks = startObservation.links
      for (let currentDepth = 1; currentDepth <= depth && results.length < RESEARCH_BATCH_MAX_PAGES; currentDepth += 1) {
        const nextLinks: UwafBrowserLink[] = []
        for (const link of currentLinks) {
          if (results.length >= RESEARCH_BATCH_MAX_PAGES) break
          if (visited.has(link.url)) continue
          try {
            const pageResult = await navigateToUrl(page, link.url, mode, false, { since, stealthProfile })
            visited.add(pageResult.url)
            results.push({
              url: pageResult.url,
              title: pageResult.title,
              markdown: pageResult.markdown.slice(0, MAX_TEXT_CHARS),
              links: pageResult.links,
              depth: currentDepth,
            })
            nextLinks.push(...pageResult.links)
          } catch {
            // Skip unreachable pages and keep crawling.
          }
        }
        currentLinks = nextLinks
      }

      return toResult('research_batch', mode, startObservation, {
        requestedUrl: request.url,
        batchResults: results,
      })
    }

    case 'fill': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')
      if (request.formIndex === undefined || request.formIndex === null) throw new Error('formIndex is required for "fill".')
      if (!request.values || Object.keys(request.values).length === 0) throw new Error('values object is required for "fill".')

      session.filledForms[request.formIndex] = {
        ...session.filledForms[request.formIndex],
        ...request.values,
      }

      for (const [name, value] of Object.entries(request.values)) {
        await page.fill(`form:nth-of-type(${request.formIndex + 1}) [name="${name}"], form:nth-of-type(${request.formIndex + 1}) [id="${name}"]`, value).catch(() => {})
      }

      const observation = await observePage(page, mode, false)
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('fill', mode, observation, {
        pendingFormValues: session.filledForms[request.formIndex],
      })
    }

    case 'submit': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')

      const formIndex = request.formIndex ?? 0
      const form = session.currentPage.forms[formIndex]
      if (!form) throw new Error(`Form ${formIndex} not found.`)

      const mergedValues = { ...session.filledForms[formIndex], ...request.values }
      for (const [name, value] of Object.entries(mergedValues)) {
        await page.fill(`form:nth-of-type(${formIndex + 1}) [name="${name}"]`, value).catch(() => {})
      }

      const since = Date.now()
      const beforeUrl = page.url()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await page.click(`form:nth-of-type(${formIndex + 1}) [type="submit"], form:nth-of-type(${formIndex + 1}) button[type="submit"]`).catch(async () => {
        await page.evaluate((index: number) => {
          const formElement = document.querySelectorAll('form')[index] as HTMLFormElement
          if (formElement) formElement.submit()
        }, formIndex)
      })
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})

      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = { url: observation.url, title: observation.title, links: observation.links, forms: observation.forms }
      if (observation.screenshot) pushScreenshot(session, observation.screenshot)

      return toResult('submit', mode, observation, {
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
        navigationChanged: observation.url !== beforeUrl,
        submitted: {
          url: form.action,
          method: form.method,
          fieldCount: Object.keys(mergedValues).length,
        },
      })
    }

    case 'type': {
      if (!request.selector?.trim()) throw new Error('selector is required for the "type" action.')
      if (request.text === undefined) throw new Error('text is required for the "type" action.')
      const locator = page.locator(request.selector).first()
      const count = await locator.count().catch(() => 0)
      if (count === 0) {
        const observation = await observePage(page, mode, takeScreenshot)
        return toResult('type', mode, observation, {
          success: false,
          error: `Selector not found: ${request.selector}`,
          failureCode: 'selector_not_found',
          failureDetail: 'No matching element was found for the provided selector.',
          selectorMatched: false,
        })
      }
      const since = Date.now()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await locator.fill(request.text)
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('type', mode, observation, {
        selectorMatched: true,
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
      })
    }

    case 'press': {
      const key = request.key?.trim()
      if (!key) throw new Error('key is required for the "press" action.')
      const since = Date.now()
      const beforeUrl = page.url()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      if (request.selector?.trim()) {
        await page.locator(request.selector).first().press(key)
      } else {
        await page.keyboard.press(key)
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {})
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('press', mode, observation, {
        selectorMatched: Boolean(request.selector),
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
        navigationChanged: observation.url !== beforeUrl,
      })
    }

    case 'wait_for_selector': {
      if (!request.selector?.trim()) throw new Error('selector is required for the "wait_for_selector" action.')
      const timeoutMs = normalizeWaitTimeout(request.timeoutMs)
      const since = Date.now()
      let selectorMatched = true
      let waitTimedOut = false
      try {
        await page.waitForSelector(request.selector, { timeout: timeoutMs, state: 'visible' })
      } catch {
        selectorMatched = false
        waitTimedOut = true
      }
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('wait_for_selector', mode, observation, {
        success: selectorMatched,
        error: selectorMatched ? undefined : `Timed out waiting for selector: ${request.selector}`,
        failureCode: selectorMatched ? undefined : 'timeout',
        failureDetail: selectorMatched ? undefined : 'The requested selector did not become visible before the timeout elapsed.',
        selectorMatched,
        waitTimedOut,
      })
    }

    case 'scroll': {
      const since = Date.now()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await page.mouse.wheel(0, normalizeDeltaY(request.deltaY))
      await page.waitForTimeout(300)
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('scroll', mode, observation, {
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
      })
    }

    case 'back': {
      const since = Date.now()
      const beforeUrl = page.url()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null)
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('back', mode, observation, {
        success: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature,
        error: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature ? undefined : 'Back navigation had no visible effect.',
        failureCode: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature ? undefined : 'no_effect',
        failureDetail: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature ? undefined : 'The browser could not navigate backward from the current state.',
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
        navigationChanged: observation.url !== beforeUrl,
      })
    }

    case 'forward': {
      const since = Date.now()
      const beforeUrl = page.url()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null)
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('forward', mode, observation, {
        success: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature,
        error: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature ? undefined : 'Forward navigation had no visible effect.',
        failureCode: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature ? undefined : 'no_effect',
        failureDetail: observation.url !== beforeUrl || observation.pageSignature !== beforeObservation.pageSignature ? undefined : 'The browser could not navigate forward from the current state.',
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
        navigationChanged: observation.url !== beforeUrl,
      })
    }

    case 'new_tab': {
      const targetUrl = request.url?.trim()
      const since = Date.now()
      const observation = targetUrl
        ? await openNewTabFromUrl(page, targetUrl, mode, takeScreenshot, since, stealthProfile)
        : await observePage(await page.context().newPage(), mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      if (observation.screenshot) pushScreenshot(session, observation.screenshot)
      return toResult('new_tab', mode, observation, {
        requestedUrl: targetUrl,
      })
    }

    case 'list_tabs': {
      const observation = await observePage(page, mode, takeScreenshot)
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('list_tabs', mode, observation)
    }

    case 'switch_tab': {
      if (request.tabIndex === undefined || request.tabIndex < 0) throw new Error('tabIndex is required for the "switch_tab" action.')
      const pages = page.context().pages().filter(item => !item.isClosed())
      const targetPage = pages[request.tabIndex]
      if (!targetPage) {
        const observation = await observePage(page, mode, takeScreenshot)
        return toResult('switch_tab', mode, observation, {
          success: false,
          error: `Tab ${request.tabIndex} not found.`,
          failureCode: 'invalid_request',
          failureDetail: 'The requested tab index does not exist.',
        })
      }
      await targetPage.bringToFront().catch(() => {})
      const observation = await observePage(targetPage, mode, takeScreenshot)
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('switch_tab', mode, observation)
    }

    case 'close_tab': {
      const pages = page.context().pages().filter(item => !item.isClosed())
      const targetIndex = request.tabIndex ?? pages.findIndex(item => item === page)
      const targetPage = pages[targetIndex]
      if (!targetPage) {
        const observation = await observePage(page, mode, takeScreenshot)
        return toResult('close_tab', mode, observation, {
          success: false,
          error: `Tab ${targetIndex} not found.`,
          failureCode: 'invalid_request',
          failureDetail: 'The requested tab index does not exist.',
        })
      }
      await targetPage.close()
      const fallbackPage = await getPage(contextKey, mode, stealthProfile)
      const observation = await observePage(fallbackPage, mode, takeScreenshot)
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('close_tab', mode, observation)
    }

    case 'select': {
      if (!request.selector?.trim()) throw new Error('selector is required for the "select" action.')
      if (!request.optionValue?.trim() && !request.optionLabel?.trim()) {
        throw new Error('optionValue or optionLabel is required for the "select" action.')
      }
      const locator = page.locator(request.selector).first()
      const count = await locator.count().catch(() => 0)
      if (count === 0) {
        const observation = await observePage(page, mode, takeScreenshot)
        return toResult('select', mode, observation, {
          success: false,
          error: `Selector not found: ${request.selector}`,
          failureCode: 'selector_not_found',
          failureDetail: 'No matching select element was found for the provided selector.',
          selectorMatched: false,
        })
      }
      const since = Date.now()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await locator.selectOption(
        request.optionValue?.trim()
          ? { value: request.optionValue.trim() }
          : { label: request.optionLabel!.trim() },
      )
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('select', mode, observation, {
        selectorMatched: true,
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
      })
    }

    case 'hover': {
      if (!request.selector?.trim()) throw new Error('selector is required for the "hover" action.')
      const locator = page.locator(request.selector).first()
      const count = await locator.count().catch(() => 0)
      if (count === 0) {
        const observation = await observePage(page, mode, takeScreenshot)
        return toResult('hover', mode, observation, {
          success: false,
          error: `Selector not found: ${request.selector}`,
          failureCode: 'selector_not_found',
          failureDetail: 'No matching element was found for the provided selector.',
          selectorMatched: false,
        })
      }
      const since = Date.now()
      const beforeObservation = await observePage(page, mode, false, { since: 0 })
      await locator.hover()
      const observation = await observePage(page, mode, takeScreenshot, { since })
      session.currentPage = {
        url: observation.url,
        title: observation.title,
        links: observation.links,
        forms: observation.forms,
      }
      return toResult('hover', mode, observation, {
        selectorMatched: true,
        pageChanged: observation.pageSignature !== beforeObservation.pageSignature,
      })
    }

    case 'wait_for_user':
      throw new Error('wait_for_user is handled by the WorkSpaces client so the human can take over the live browser.')

    default:
      throw new Error(`Unknown UWAF browser action: ${String(request.action)}`)
  }
}

export function getUwafBrowserSession(userId: string, sessionId: string, mode: BrowserMode): UwafBrowserSession | undefined {
  return sessions.get(getSessionKey(userId, sessionId, mode))
}

export { assertPublicHttpUrl }
