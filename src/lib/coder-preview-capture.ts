import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { parsePreviewUrl, PREVIEW_VIEWPORTS, type PreviewDevice } from './coder-preview'
import { verifyPreviewTicket } from './coder-preview-ticket'

const MAX_CAPTURE_BYTES = 3 * 1024 * 1024
const MAX_CONCURRENT_CAPTURES = 2
const MAX_DIAGNOSTIC_LINES = 160

export class PreviewCaptureError extends Error {
  constructor(readonly code: 'invalid_preview_url' | 'preview_busy' | 'preview_unreachable' | 'preview_too_large') {
    super(code)
  }
}

export interface PreviewDiagnosticEntry {
  level: 'console' | 'pageerror' | 'requestfailed' | 'response'
  message: string
}

let activeCaptures = 0

interface ValidatedCaptureUrl {
  url: URL
  mode: 'local' | 'public' | 'onion'
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
  }
  return normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
}

async function publicHostname(hostname: string) {
  if (!hostname || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isIP(hostname)) return false
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    return addresses.length > 0 && addresses.every(result => !privateAddress(result.address))
  } catch {
    return false
  }
}

async function validateCaptureUrl(raw: string): Promise<ValidatedCaptureUrl> {
  try {
    const url = new URL(raw)
    const gatewayPort = String(process.env.CODER_PREVIEW_GATEWAY_PORT || 4173)
    if (['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.port === gatewayPort
      && url.pathname === '/__peakui/open'
      && verifyPreviewTicket(url.searchParams.get('ticket') || '')) return { url, mode: 'local' }
  } catch { /* Fall through to ordinary local-preview validation. */ }
  const parsed = parsePreviewUrl(raw, { allowRemote: true })
  if ('error' in parsed) throw new PreviewCaptureError('invalid_preview_url')
  const url = new URL(raw)
  if (url.hostname.endsWith('.onion')) {
    if (!process.env.TOR_PROXY_URL) throw new PreviewCaptureError('invalid_preview_url')
    return { url, mode: 'onion' }
  }
  if (!await publicHostname(url.hostname)) throw new PreviewCaptureError('invalid_preview_url')
  return { url, mode: 'public' }
}

function chromiumArgs(mode: ValidatedCaptureUrl['mode']) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions']
  if (mode === 'onion') {
    const proxy = new URL(process.env.TOR_PROXY_URL!)
    args.push(`--proxy-server=socks5://${proxy.host}`)
  }
  return args
}

async function requestAllowed(raw: string, target: ValidatedCaptureUrl) {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (['data:', 'blob:'].includes(url.protocol)) return true
  if (!['http:', 'https:'].includes(url.protocol)) return false
  if (target.mode === 'local') return url.origin === target.url.origin
  if (target.mode === 'onion') return url.hostname.endsWith('.onion')
  return publicHostname(url.hostname)
}

/**
 * Capture the same safe loopback target and viewport shown in the preview pane.
 * The browser is isolated from all origins except the approved preview origin,
 * so a page cannot turn capture into a server-side request to another service.
 */
export async function capturePreviewScreenshot(input: { url: string; device: PreviewDevice }) {
  const target = await validateCaptureUrl(input.url)
  if (activeCaptures >= MAX_CONCURRENT_CAPTURES) throw new PreviewCaptureError('preview_busy')

  activeCaptures += 1
  let browser: import('playwright-core').Browser | undefined
  try {
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
      args: chromiumArgs(target.mode),
    })
    const viewport = PREVIEW_VIEWPORTS[input.device]
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' })
    const page = await context.newPage()

    await page.route('**/*', async route => {
      return await requestAllowed(route.request().url(), target) ? route.continue() : route.abort('blockedbyclient')
    })

    const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    if (!response || response.status() >= 400 || !await requestAllowed(page.url(), target)) {
      throw new PreviewCaptureError('preview_unreachable')
    }
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {})
    const bytes = await page.screenshot({ type: 'jpeg', quality: 82 })
    await context.close()
    if (bytes.byteLength > MAX_CAPTURE_BYTES) throw new PreviewCaptureError('preview_too_large')
    return { data: bytes.toString('base64'), mimeType: 'image/jpeg' as const, ...viewport }
  } catch (error) {
    if (error instanceof PreviewCaptureError) throw error
    throw new PreviewCaptureError('preview_unreachable')
  } finally {
    activeCaptures -= 1
    await browser?.close().catch(() => {})
  }
}

/**
 * Run the preview in Chromium and collect browser-visible faults. The iframe
 * cannot safely expose its own console to the parent, so this uses the same
 * isolated capture runtime as Vision and reports its console, failed requests,
 * and HTTP failures in a copyable form.
 */
export async function collectPreviewDiagnostics(input: { url: string; device: PreviewDevice }) {
  const target = await validateCaptureUrl(input.url)
  if (activeCaptures >= MAX_CONCURRENT_CAPTURES) throw new PreviewCaptureError('preview_busy')

  activeCaptures += 1
  let browser: import('playwright-core').Browser | undefined
  const entries: PreviewDiagnosticEntry[] = []
  const add = (level: PreviewDiagnosticEntry['level'], message: string) => {
    if (entries.length < MAX_DIAGNOSTIC_LINES) entries.push({ level, message: message.slice(0, 2000) })
  }
  try {
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
      args: chromiumArgs(target.mode),
    })
    const context = await browser.newContext({ viewport: PREVIEW_VIEWPORTS[input.device], deviceScaleFactor: 1, serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.route('**/*', async route => {
      return await requestAllowed(route.request().url(), target) ? route.continue() : route.abort('blockedbyclient')
    })
    page.on('console', message => add('console', `[${message.type()}] ${message.text()}`))
    page.on('pageerror', error => add('pageerror', error.message))
    page.on('requestfailed', request => add('requestfailed', `${request.failure()?.errorText || 'failed'} ${request.url()}`))
    page.on('response', response => {
      if (response.status() >= 400) add('response', `HTTP ${response.status()} ${response.url()}`)
    })

    const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    if (!response || response.status() >= 400 || !await requestAllowed(page.url(), target)) {
      throw new PreviewCaptureError('preview_unreachable')
    }
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {})
    await context.close()
    return { entries }
  } catch (error) {
    if (error instanceof PreviewCaptureError) throw error
    throw new PreviewCaptureError('preview_unreachable')
  } finally {
    activeCaptures -= 1
    await browser?.close().catch(() => {})
  }
}
