import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { Page } from 'playwright-core'
import { getPage, closeContext, type BrowserMode } from './uwaf-pool'
import {
  sanitizeHtmlToMarkdown,
  extractTables,
  extractMetadata,
  isBlockedBinaryUrl,
  type SanitizeOptions,
  type ExtractedTable,
} from './uwaf-sanitizer'
import type { OpenClawUwafBrowserMode } from './settings'

// Re-export SSRF protection from the existing browser module
import { assertPublicHttpUrl } from './openclaw-browser'

const MAX_TEXT_CHARS = 30_000
const MAX_LINKS = 50
const SCREENSHOT_MAX_WIDTH = 800
const SCREENSHOT_QUALITY = 60
const RESEARCH_BATCH_MAX_DEPTH = 3
const RESEARCH_BATCH_MAX_PAGES = 10
const SESSION_TTL_MS = 60 * 60 * 1000

export type UwafAction = 'search' | 'open' | 'click' | 'extract_table' | 'research_batch' | 'fill' | 'submit' | 'extract' | 'wait_for_user'

export interface UwafBrowserRequest {
  action: UwafAction
  sessionId: string
  query?: string
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  browserMode?: BrowserMode
  depth?: number
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
  source?: 'clear_web' | 'dark_web'
  pendingFormValues?: Record<string, string>
  submitted?: {
    url: string
    method: 'GET' | 'POST'
    fieldCount: number
  }
  batchResults?: UwafBatchResult[]
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

const sessions = new Map<string, UwafBrowserSession>()

function getSessionKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

function getOrCreateSession(userId: string, sessionId: string, mode: BrowserMode): UwafBrowserSession {
  cleanupExpiredSessions()
  const key = getSessionKey(userId, sessionId)
  const existing = sessions.get(key)
  if (existing && existing.mode === mode && Date.now() - existing.updatedAt < SESSION_TTL_MS) {
    existing.updatedAt = Date.now()
    return existing
  }
  const session: UwafBrowserSession = {
    userId,
    sessionId,
    mode,
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

function isOnionUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.onion')
  } catch {
    return false
  }
}

async function assertUwafUrlAllowed(rawUrl: string, mode: BrowserMode): Promise<URL> {
  const url = await assertPublicHttpUrl(rawUrl)

  if (isOnionUrl(rawUrl)) {
    if (mode !== 'stealth') {
      throw new Error(`.onion URLs are only accessible in Stealth (Tor) mode. Switch to Stealth mode to access: ${rawUrl}`)
    }
    return url
  }

  return url
}

function extractLinksFromPage(page: Page): Promise<UwafBrowserLink[]> {
  return page.evaluate((maxLinks: number) => {
    const links: { index: number; text: string; url: string }[] = []
    const anchors = document.querySelectorAll('a[href]')
    for (let i = 0; i < anchors.length && links.length < maxLinks; i++) {
      const a = anchors[i] as HTMLAnchorElement
      const href = a.href
      if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('mailto:')) continue
      const text = (a.textContent || '').trim().slice(0, 200)
      if (text && href) {
        links.push({ index: links.length, text, url: href })
      }
    }
    return links
  }, MAX_LINKS)
}

function extractFormsFromPage(page: Page): Promise<UwafBrowserForm[]> {
  return page.evaluate<UwafBrowserForm[], number>((maxForms: number) => {
    const forms: UwafBrowserForm[] = []
    const formElements = document.querySelectorAll('form')
    for (let i = 0; i < formElements.length && forms.length < maxForms; i++) {
      const form = formElements[i] as HTMLFormElement
      const fields: { name: string; type: string; value?: string }[] = []
      const inputs = form.querySelectorAll('input, textarea, select')
      for (let j = 0; j < inputs.length && fields.length < 30; j++) {
        const input = inputs[j] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        const name = input.getAttribute('name') || input.id || `field_${j}`
        const type = input.getAttribute('type') || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName === 'SELECT' ? 'select' : 'text')
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

async function navigateToUrl(
  page: Page,
  url: string,
  mode: BrowserMode,
  takeScreenshot: boolean,
): Promise<{
  url: string
  title: string
  text: string
  html: string
  markdown: string
  links: UwafBrowserLink[]
  forms: UwafBrowserForm[]
  tables: ExtractedTable[]
  screenshot?: string
}> {
  await assertUwafUrlAllowed(url, mode)

  if (isBlockedBinaryUrl(url)) {
    throw new Error(`Blocked: URLs pointing to executable files are not allowed for security reasons. If you need this file, request manual unpacking approval.`)
  }

  await page.bringToFront().catch(() => {})
  await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' })
  await page.bringToFront().catch(() => {})

  await page.waitForTimeout(500)

  const currentUrl = page.url()
  const title = await page.title()
  const html = await page.content()

  const response = await page.evaluate(() => {
    const contentType = document.contentType || ''
    return { contentType }
  })

  if (isBlockedBinaryUrl(currentUrl, response.contentType)) {
    throw new Error(`Blocked: This page appears to serve an executable file. Downloading binaries requires explicit unpacking approval.`)
  }

  const sanitizeOpts: SanitizeOptions = {
    strict: mode === 'stealth',
    maxTextLength: MAX_TEXT_CHARS,
    preserveTables: true,
  }

  const markdown = sanitizeHtmlToMarkdown(html, sanitizeOpts)
  const text = markdown.slice(0, MAX_TEXT_CHARS)
  const tables = extractTables(html)
  const links = await extractLinksFromPage(page)
  const forms = await extractFormsFromPage(page)
  const screenshot = takeScreenshot ? await captureScreenshot(page) : undefined

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
  }
}

function buildSearchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query.trim())}`
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

  if (mode === 'stealth') {
    const { checkTorProxyStatus } = await import('./uwaf-pool')
    const torStatus = await checkTorProxyStatus()
    if (!torStatus.reachable) {
      throw new Error(`Stealth mode requires a Tor proxy but it is currently unavailable: ${torStatus.error || 'Connection failed'}. Ensure the tor-proxy service is running.`)
    }
  }

  const session = getOrCreateSession(userId, request.sessionId, mode)
  const takeScreenshot = settings.openClawUwafScreenshots !== false
  const contextKey = getSessionKey(userId, request.sessionId)
  const page = await getPage(contextKey, mode)

  switch (request.action) {
    case 'search': {
      if (!request.query?.trim()) throw new Error('Query is required for the "search" action.')
      const result = await navigateToUrl(page, buildSearchUrl(request.query), mode, takeScreenshot)

      session.currentPage = {
        url: result.url,
        title: result.title,
        links: result.links,
        forms: result.forms,
      }
      if (result.screenshot) {
        pushScreenshot(session, result.screenshot)
      }

      return {
        action: 'search',
        currentUrl: result.url,
        title: result.title,
        text: result.text,
        markdown: result.markdown,
        links: result.links,
        forms: result.forms,
        tables: result.tables,
        screenshot: result.screenshot,
        mode,
        source: getSourceMode(mode),
      }
    }

    case 'open': {
      if (!request.url) throw new Error('URL is required for the "open" action.')
      const result = await navigateToUrl(page, request.url, mode, takeScreenshot)

      session.currentPage = {
        url: result.url,
        title: result.title,
        links: result.links,
        forms: result.forms,
      }
      if (result.screenshot) {
        pushScreenshot(session, result.screenshot)
      }

      return {
        action: 'open',
        currentUrl: result.url,
        title: result.title,
        text: result.text,
        markdown: result.markdown,
        links: result.links,
        forms: result.forms,
        tables: result.tables,
        screenshot: result.screenshot,
        mode,
        source: getSourceMode(mode),
      }
    }

    case 'click': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')
      let targetUrl: string | undefined
      if (request.linkIndex !== undefined && request.linkIndex >= 0 && request.linkIndex < session.currentPage.links.length) {
        targetUrl = session.currentPage.links[request.linkIndex].url
      } else if (request.linkText) {
        const link = session.currentPage.links.find(l => l.text.toLowerCase().includes(request.linkText!.toLowerCase()))
        if (link) targetUrl = link.url
      }
      if (!targetUrl) throw new Error(`Link not found. Available links: 0–${session.currentPage.links.length - 1}`)

      const result = await navigateToUrl(page, targetUrl, mode, takeScreenshot)
      session.currentPage = { url: result.url, title: result.title, links: result.links, forms: result.forms }
      if (result.screenshot) pushScreenshot(session, result.screenshot)

      return {
        action: 'click',
        currentUrl: result.url,
        title: result.title,
        text: result.text,
        markdown: result.markdown,
        links: result.links,
        forms: result.forms,
        tables: result.tables,
        screenshot: result.screenshot,
        mode,
        source: getSourceMode(mode),
      }
    }

    case 'extract': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')
      const html = await page.content()
      const extractMode = request.mode || 'summary'
      const sanitizeOpts: SanitizeOptions = { strict: mode === 'stealth', maxTextLength: MAX_TEXT_CHARS, preserveTables: true }
      const markdown = sanitizeHtmlToMarkdown(html, sanitizeOpts)
      const links = await extractLinksFromPage(page)
      const forms = await extractFormsFromPage(page)
      const screenshot = takeScreenshot ? await captureScreenshot(page) : undefined

      const result: UwafBrowserResult = {
        action: 'extract',
        currentUrl: session.currentPage.url,
        title: session.currentPage.title,
        text: extractMode === 'links' ? '' : markdown.slice(0, MAX_TEXT_CHARS),
        markdown: extractMode !== 'links' ? markdown : undefined,
        html: extractMode === 'html' ? html.slice(0, 20_000) : undefined,
        links,
        forms: extractMode === 'forms' || extractMode === 'html' ? forms : [],
        tables: extractMode !== 'links' ? extractTables(html) : [],
        screenshot,
        mode,
        source: getSourceMode(mode),
      }
      return result
    }

    case 'extract_table': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')
      const html = await page.content()
      const tables = extractTables(html)
      const screenshot = takeScreenshot ? await captureScreenshot(page) : undefined

      return {
        action: 'extract_table',
        currentUrl: session.currentPage.url,
        title: session.currentPage.title,
        text: tables.map(t => t.markdown).join('\n\n'),
        markdown: tables.map(t => t.markdown).join('\n\n'),
        links: [],
        forms: [],
        tables,
        screenshot,
        mode,
        source: getSourceMode(mode),
      }
    }

    case 'research_batch': {
      if (!request.url) throw new Error('URL is required for "research_batch" action.')
      const depth = Math.min(Math.max(request.depth || 1, 1), RESEARCH_BATCH_MAX_DEPTH)
      const results: UwafBatchResult[] = []
      const visited = new Set<string>()

      await assertUwafUrlAllowed(request.url, mode)

      const startResult = await navigateToUrl(page, request.url, mode, takeScreenshot)
      visited.add(startResult.url)
      results.push({
        url: startResult.url,
        title: startResult.title,
        markdown: startResult.markdown.slice(0, MAX_TEXT_CHARS),
        links: startResult.links,
        depth: 0,
      })

      session.currentPage = {
        url: startResult.url,
        title: startResult.title,
        links: startResult.links,
        forms: startResult.forms,
      }
      if (startResult.screenshot) pushScreenshot(session, startResult.screenshot)

      let currentLinks = startResult.links
      for (let d = 1; d <= depth && results.length < RESEARCH_BATCH_MAX_PAGES; d++) {
        const nextLinks: UwafBrowserLink[] = []
        for (const link of currentLinks) {
          if (results.length >= RESEARCH_BATCH_MAX_PAGES) break
          if (visited.has(link.url)) continue
          try {
            const pageResult = await navigateToUrl(page, link.url, mode, false)
            visited.add(pageResult.url)
            results.push({
              url: pageResult.url,
              title: pageResult.title,
              markdown: pageResult.markdown.slice(0, MAX_TEXT_CHARS),
              links: pageResult.links,
              depth: d,
            })
            nextLinks.push(...pageResult.links)
          } catch {
            // Skip unreachable pages
          }
        }
        currentLinks = nextLinks
      }

      return {
        action: 'research_batch',
        currentUrl: startResult.url,
        title: startResult.title,
        text: startResult.text,
        markdown: startResult.markdown,
        links: startResult.links,
        forms: startResult.forms,
        tables: startResult.tables,
        screenshot: startResult.screenshot,
        mode,
        source: getSourceMode(mode),
        batchResults: results,
      }
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
        await page.fill(`form:nth-of-type(${request.formIndex + 1}) [name="${name}"], form:nth-of-type(${request.formIndex + 1}) [id="${name}"]`, value).catch(() => {
          // Try alternative selectors if name-based fill fails
        })
      }

      const links = await extractLinksFromPage(page)
      const forms = await extractFormsFromPage(page)

      return {
        action: 'fill',
        currentUrl: session.currentPage.url,
        title: session.currentPage.title,
        text: '',
        links,
        forms,
        pendingFormValues: session.filledForms[request.formIndex],
        mode,
        source: getSourceMode(mode),
      }
    }

    case 'submit': {
      await syncSessionCurrentPage(session, page)
      if (!session.currentPage) throw new Error('No page is currently open. Use "open" first.')

      const formIndex = request.formIndex ?? 0
      const form = session.currentPage.forms[formIndex]
      if (!form) throw new Error(`Form ${formIndex} not found.`)

      const mergedValues = { ...session.filledForms[formIndex], ...request.values }

      for (const [name, value] of Object.entries(mergedValues)) {
        try {
          await page.fill(`form:nth-of-type(${formIndex + 1}) [name="${name}"]`, value)
        } catch {
          // Field may not be fillable, skip
        }
      }

      await page.click(`form:nth-of-type(${formIndex + 1}) [type="submit"], form:nth-of-type(${formIndex + 1}) button[type="submit"]`).catch(async () => {
        await page.evaluate((idx: number) => {
          const form = document.querySelectorAll('form')[idx] as HTMLFormElement
          if (form) form.submit()
        }, formIndex)
      })

      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})

      const submitUrl = page.url()
      const title = await page.title()
      const html = await page.content()
      const sanitizeOpts: SanitizeOptions = { strict: mode === 'stealth', maxTextLength: MAX_TEXT_CHARS, preserveTables: true }
      const markdown = sanitizeHtmlToMarkdown(html, sanitizeOpts)
      const links = await extractLinksFromPage(page)
      const forms = await extractFormsFromPage(page)
      const screenshot = takeScreenshot ? await captureScreenshot(page) : undefined

      session.currentPage = { url: submitUrl, title, links, forms }
      if (screenshot) pushScreenshot(session, screenshot)

      return {
        action: 'submit',
        currentUrl: submitUrl,
        title,
        text: markdown.slice(0, MAX_TEXT_CHARS),
        markdown,
        links,
        forms,
        screenshot,
        mode,
        source: getSourceMode(mode),
        submitted: {
          url: form.action,
          method: form.method,
          fieldCount: Object.keys(mergedValues).length,
        },
      }
    }

    case 'wait_for_user':
      throw new Error('wait_for_user is handled by the OpenClaw client so the human can take over the live browser.')

    default:
      throw new Error(`Unknown UWAF browser action: ${request.action}`)
  }
}

export function getUwafBrowserSession(userId: string, sessionId: string): UwafBrowserSession | undefined {
  return sessions.get(getSessionKey(userId, sessionId))
}

export { assertPublicHttpUrl }
