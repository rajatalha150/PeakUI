import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { OpenClawBrowserMode } from './settings'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 15000
const MAX_TEXT_CHARS = 20_000
const MAX_HTML_CHARS = 12_000
const MAX_LINKS = 30
const MAX_FORMS = 10
const MAX_FIELDS_PER_FORM = 30
const SESSION_TTL_MS = 60 * 60 * 1000

export interface OpenClawBrowserRequest {
  action: 'open' | 'click' | 'fill' | 'submit' | 'extract'
  sessionId: string
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
}

export interface OpenClawBrowserSettings {
  openClawBrowserMode: OpenClawBrowserMode
}

export interface OpenClawBrowserLink {
  index: number
  text: string
  url: string
}

export interface OpenClawBrowserFormField {
  name: string
  type: string
  value?: string
}

export interface OpenClawBrowserForm {
  index: number
  action: string
  method: 'GET' | 'POST'
  fields: OpenClawBrowserFormField[]
}

export interface OpenClawBrowserResult {
  action: OpenClawBrowserRequest['action']
  currentUrl: string
  title: string
  text: string
  html?: string
  links: OpenClawBrowserLink[]
  forms: OpenClawBrowserForm[]
  pendingFormValues?: Record<string, string>
  submitted?: {
    url: string
    method: 'GET' | 'POST'
    fieldCount: number
  }
}

export interface OpenClawBrowserSubmitPreparation {
  formIndex: number
  submitUrl: string
  method: 'GET' | 'POST'
  values: Record<string, string>
}

interface CookieRecord {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  expiresAt?: number
}

interface BrowserPageSnapshot {
  url: string
  title: string
  html: string
  text: string
  links: OpenClawBrowserLink[]
  forms: OpenClawBrowserForm[]
}

interface BrowserSessionState {
  userId: string
  sessionId: string
  updatedAt: number
  cookies: CookieRecord[]
  currentPage?: BrowserPageSnapshot
  filledForms: Record<number, Record<string, string>>
}

const browserSessions = new Map<string, BrowserSessionState>()

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

function cleanupExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [key, session] of browserSessions.entries()) {
    if (session.updatedAt < cutoff) {
      browserSessions.delete(key)
    }
  }
}

function getSessionKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

function getOrCreateBrowserSession(userId: string, sessionId: string): BrowserSessionState {
  cleanupExpiredSessions()
  const key = getSessionKey(userId, sessionId)
  const existing = browserSessions.get(key)
  if (existing) {
    existing.updatedAt = Date.now()
    return existing
  }

  const created: BrowserSessionState = {
    userId,
    sessionId,
    updatedAt: Date.now(),
    cookies: [],
    filledForms: {},
  }
  browserSessions.set(key, created)
  return created
}

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

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
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
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
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

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw))) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] || match[3] || match[4] || '')
  }
  return attributes
}

function extractLinks(html: string, pageUrl: string): OpenClawBrowserLink[] {
  const links: OpenClawBrowserLink[] = []
  const seen = new Set<string>()
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html)) && links.length < MAX_LINKS) {
    const attributes = parseAttributes(match[1])
    const rawHref = attributes.href
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('#')) {
      continue
    }

    try {
      const resolved = new URL(rawHref, pageUrl).toString()
      if (seen.has(resolved)) continue
      seen.add(resolved)
      links.push({
        index: links.length + 1,
        text: stripTags(match[2]) || resolved,
        url: resolved,
      })
    } catch {
      continue
    }
  }

  return links
}

function extractFormFields(formBody: string): OpenClawBrowserFormField[] {
  const fields: OpenClawBrowserFormField[] = []
  const pattern = /<(input|textarea|select)\b([^>]*)(?:>([\s\S]*?)<\/\1>|\/?>)/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(formBody)) && fields.length < MAX_FIELDS_PER_FORM) {
    const tagName = match[1].toLowerCase()
    const attributes = parseAttributes(match[2])
    const name = attributes.name?.trim()
    if (!name) continue

    let value = attributes.value || ''
    if (tagName === 'textarea') {
      value = decodeHtmlEntities(match[3] || '')
    }

    fields.push({
      name,
      type: attributes.type || tagName,
      value: value || undefined,
    })
  }

  return fields
}

function extractForms(html: string, pageUrl: string): OpenClawBrowserForm[] {
  const forms: OpenClawBrowserForm[] = []
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html)) && forms.length < MAX_FORMS) {
    const attributes = parseAttributes(match[1])
    const method = attributes.method?.toUpperCase() === 'POST' ? 'POST' : 'GET'
    const actionUrl = new URL(attributes.action || pageUrl, pageUrl).toString()
    forms.push({
      index: forms.length + 1,
      action: actionUrl,
      method,
      fields: extractFormFields(match[2]),
    })
  }

  return forms
}

function parseHtmlPage(html: string, url: string): BrowserPageSnapshot {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? stripTags(titleMatch[1]) : url
  const stripped = normalizeWhitespace(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )

  return {
    url,
    title,
    html: truncate(html, MAX_HTML_CHARS),
    text: truncate(decodeHtmlEntities(stripped), MAX_TEXT_CHARS),
    links: extractLinks(html, url),
    forms: extractForms(html, url),
  }
}

function parseSetCookieHeader(setCookie: string, responseUrl: string): CookieRecord | null {
  const parts = setCookie.split(';').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const [nameValue, ...attributes] = parts
  const separatorIndex = nameValue.indexOf('=')
  if (separatorIndex <= 0) return null

  const url = new URL(responseUrl)
  const cookie: CookieRecord = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    domain: url.hostname,
    path: '/',
    secure: false,
  }

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=')
    const key = rawKey.toLowerCase()
    const value = rest.join('=')
    if (key === 'domain' && value) {
      cookie.domain = value.replace(/^\./, '').toLowerCase()
    } else if (key === 'path' && value) {
      cookie.path = value
    } else if (key === 'secure') {
      cookie.secure = true
    } else if (key === 'max-age') {
      const seconds = Number(value)
      if (Number.isFinite(seconds)) {
        cookie.expiresAt = Date.now() + seconds * 1000
      }
    } else if (key === 'expires' && value) {
      const expiresAt = Date.parse(value)
      if (!Number.isNaN(expiresAt)) {
        cookie.expiresAt = expiresAt
      }
    }
  }

  return cookie
}

function storeCookies(session: BrowserSessionState, response: Response, responseUrl: string) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : response.headers.get('set-cookie')
      ? [response.headers.get('set-cookie') as string]
      : []

  for (const headerValue of setCookies) {
    const parsed = parseSetCookieHeader(headerValue, responseUrl)
    if (!parsed) continue
    session.cookies = session.cookies.filter(cookie => !(
      cookie.name === parsed.name
      && cookie.domain === parsed.domain
      && cookie.path === parsed.path
    ))

    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      continue
    }

    session.cookies.push(parsed)
  }
}

function buildCookieHeader(session: BrowserSessionState, url: URL): string {
  session.cookies = session.cookies.filter(cookie => !cookie.expiresAt || cookie.expiresAt > Date.now())

  return session.cookies
    .filter(cookie => (
      (url.hostname === cookie.domain || url.hostname.endsWith(`.${cookie.domain}`))
      && url.pathname.startsWith(cookie.path)
      && (!cookie.secure || url.protocol === 'https:')
    ))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

async function fetchBrowserPage(
  session: BrowserSessionState,
  targetUrl: string,
  options?: { method?: 'GET' | 'POST'; body?: string; contentType?: string }
): Promise<BrowserPageSnapshot> {
  const url = await assertPublicHttpUrl(targetUrl)
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  const cookieHeader = buildCookieHeader(session, url)
  if (cookieHeader) {
    headers.Cookie = cookieHeader
  }
  if (options?.contentType) {
    headers['Content-Type'] = options.contentType
  }

  const response = await fetch(url.toString(), {
    method: options?.method || 'GET',
    headers,
    body: options?.body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Browser request failed with status ${response.status}`)
  }

  const finalUrl = response.url || url.toString()
  storeCookies(session, response, finalUrl)
  const html = await response.text()
  const page = parseHtmlPage(html, finalUrl)
  session.currentPage = page
  session.filledForms = {}
  session.updatedAt = Date.now()
  return page
}

function requireCurrentPage(session: BrowserSessionState): BrowserPageSnapshot {
  if (!session.currentPage) {
    throw new Error('No browser page is open yet. Open a URL first.')
  }
  return session.currentPage
}

function findForm(page: BrowserPageSnapshot, formIndex?: number): OpenClawBrowserForm {
  if (page.forms.length === 0) {
    throw new Error('The current page does not expose any HTML forms')
  }

  if (formIndex === undefined) {
    if (page.forms.length === 1) return page.forms[0]
    throw new Error('Multiple forms are available. Specify formIndex explicitly.')
  }

  const form = page.forms.find(entry => entry.index === formIndex)
  if (!form) {
    throw new Error(`No form with index ${formIndex} was found on the current page`)
  }
  return form
}

function findLink(page: BrowserPageSnapshot, input: { linkIndex?: number; linkText?: string }): OpenClawBrowserLink {
  if (input.linkIndex !== undefined) {
    const link = page.links.find(entry => entry.index === input.linkIndex)
    if (!link) {
      throw new Error(`No link with index ${input.linkIndex} was found on the current page`)
    }
    return link
  }

  if (!input.linkText?.trim()) {
    throw new Error('click requires linkIndex or linkText')
  }

  const desired = input.linkText.trim().toLowerCase()
  const link = page.links.find(entry => entry.text.toLowerCase().includes(desired))
  if (!link) {
    throw new Error(`No link matching "${input.linkText}" was found on the current page`)
  }

  return link
}

function buildBrowserResult(
  action: OpenClawBrowserRequest['action'],
  page: BrowserPageSnapshot,
  options?: {
    mode?: OpenClawBrowserRequest['mode']
    pendingFormValues?: Record<string, string>
    submitted?: OpenClawBrowserResult['submitted']
  }
): OpenClawBrowserResult {
  const mode = options?.mode || 'summary'
  return {
    action,
    currentUrl: page.url,
    title: page.title,
    text: mode === 'links' || mode === 'forms' ? '' : page.text,
    html: mode === 'html' ? page.html : undefined,
    links: mode === 'forms' ? [] : page.links,
    forms: mode === 'links' ? [] : page.forms,
    ...(options?.pendingFormValues ? { pendingFormValues: options.pendingFormValues } : {}),
    ...(options?.submitted ? { submitted: options.submitted } : {}),
  }
}

export function prepareOpenClawBrowserSubmit(
  request: OpenClawBrowserRequest,
  session: BrowserSessionState
): OpenClawBrowserSubmitPreparation {
  const page = requireCurrentPage(session)
  const form = findForm(page, request.formIndex)
  const defaultValues = Object.fromEntries(
    form.fields
      .filter(field => field.name)
      .map(field => [field.name, field.value || ''])
  )
  const pendingValues = session.filledForms[form.index] || {}
  const values = { ...defaultValues, ...pendingValues }

  return {
    formIndex: form.index,
    submitUrl: form.action,
    method: form.method,
    values,
  }
}

export function buildOpenClawBrowserApprovalPayload(
  request: OpenClawBrowserRequest,
  preparation: OpenClawBrowserSubmitPreparation
) {
  return {
    action: request.action,
    sessionId: request.sessionId,
    formIndex: preparation.formIndex,
    submitUrl: preparation.submitUrl,
    method: preparation.method,
    values: preparation.values,
  }
}

export async function runOpenClawBrowserAction(
  userId: string,
  request: OpenClawBrowserRequest,
  settings: OpenClawBrowserSettings
): Promise<OpenClawBrowserResult> {
  if (settings.openClawBrowserMode === 'deny') {
    throw new Error('Browser control is disabled')
  }

  if (!request.sessionId.trim()) {
    throw new Error('A valid Open Claw session id is required for browser control')
  }

  const session = getOrCreateBrowserSession(userId, request.sessionId.trim())

  if (request.action === 'open') {
    if (!request.url?.trim()) {
      throw new Error('Browser open requires a URL')
    }
    const page = await fetchBrowserPage(session, request.url.trim())
    return buildBrowserResult('open', page, { mode: request.mode })
  }

  if (request.action === 'click') {
    const page = requireCurrentPage(session)
    const link = findLink(page, { linkIndex: request.linkIndex, linkText: request.linkText })
    const nextPage = await fetchBrowserPage(session, link.url)
    return buildBrowserResult('click', nextPage, { mode: request.mode })
  }

  if (request.action === 'extract') {
    const page = requireCurrentPage(session)
    return buildBrowserResult('extract', page, { mode: request.mode })
  }

  if (settings.openClawBrowserMode === 'read-only') {
    throw new Error('Browser mode is read-only, so form interactions are blocked')
  }

  if (request.action === 'fill') {
    const page = requireCurrentPage(session)
    const form = findForm(page, request.formIndex)
    const nextValues = {
      ...(session.filledForms[form.index] || {}),
      ...(request.values || {}),
    }
    session.filledForms[form.index] = nextValues
    session.updatedAt = Date.now()
    return buildBrowserResult('fill', page, {
      mode: 'forms',
      pendingFormValues: nextValues,
    })
  }

  const submission = prepareOpenClawBrowserSubmit(request, session)
  const params = new URLSearchParams()
  Object.entries(submission.values).forEach(([key, value]) => {
    params.set(key, value)
  })

  const targetUrl = submission.method === 'GET'
    ? (() => {
        const url = new URL(submission.submitUrl)
        url.search = params.toString()
        return url.toString()
      })()
    : submission.submitUrl

  const page = await fetchBrowserPage(session, targetUrl, submission.method === 'POST'
    ? {
        method: 'POST',
        body: params.toString(),
        contentType: 'application/x-www-form-urlencoded',
      }
    : undefined)

  return buildBrowserResult('submit', page, {
    mode: request.mode,
    submitted: {
      url: submission.submitUrl,
      method: submission.method,
      fieldCount: Object.keys(submission.values).length,
    },
  })
}

export function getOpenClawBrowserSession(userId: string, sessionId: string): BrowserSessionState {
  return getOrCreateBrowserSession(userId, sessionId)
}
