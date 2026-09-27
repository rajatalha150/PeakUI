import { parsePreviewUrl, PREVIEW_VIEWPORTS, type PreviewDevice } from './coder-preview'

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

/**
 * Capture the same safe loopback target and viewport shown in the preview pane.
 * The browser is isolated from all origins except the approved preview origin,
 * so a page cannot turn capture into a server-side request to another service.
 */
export async function capturePreviewScreenshot(input: { url: string; device: PreviewDevice }) {
  const parsed = parsePreviewUrl(input.url)
  if ('error' in parsed) throw new PreviewCaptureError('invalid_preview_url')
  if (activeCaptures >= MAX_CONCURRENT_CAPTURES) throw new PreviewCaptureError('preview_busy')

  activeCaptures += 1
  let browser: import('playwright-core').Browser | undefined
  try {
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
    })
    const viewport = PREVIEW_VIEWPORTS[input.device]
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const targetOrigin = new URL(input.url).origin

    await page.route('**/*', route => {
      try {
        return new URL(route.request().url()).origin === targetOrigin ? route.continue() : route.abort()
      } catch {
        return route.abort()
      }
    })

    const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    if (!response || response.status() >= 400 || new URL(page.url()).origin !== targetOrigin) {
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
  const parsed = parsePreviewUrl(input.url)
  if ('error' in parsed) throw new PreviewCaptureError('invalid_preview_url')
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
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
    })
    const context = await browser.newContext({ viewport: PREVIEW_VIEWPORTS[input.device], deviceScaleFactor: 1 })
    const page = await context.newPage()
    const targetOrigin = new URL(input.url).origin
    await page.route('**/*', route => {
      try {
        return new URL(route.request().url()).origin === targetOrigin ? route.continue() : route.abort()
      } catch {
        return route.abort()
      }
    })
    page.on('console', message => add('console', `[${message.type()}] ${message.text()}`))
    page.on('pageerror', error => add('pageerror', error.message))
    page.on('requestfailed', request => add('requestfailed', `${request.failure()?.errorText || 'failed'} ${request.url()}`))
    page.on('response', response => {
      if (response.status() >= 400) add('response', `HTTP ${response.status()} ${response.url()}`)
    })

    const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    if (!response || response.status() >= 400 || new URL(page.url()).origin !== targetOrigin) {
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
