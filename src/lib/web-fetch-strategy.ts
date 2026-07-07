import type { BrowserMode } from './uwaf-pool'
import { fetchPublicWebPage } from './web-context'
import type { MessageSource } from './message-sources'
import { looksLikeChallengePage } from './captcha-solver'

/**
 * Browser-Grade fetch layer (Option A of the web-trust plan).
 *
 * Replaces the plain HTTP fetch in `fetchPublicWebPage` for sites that need
 * JavaScript to render their content (the SEC EDGAR XBRL viewer, GitHub
 * `/blob/...` routes, modern SPAs, etc.).
 *
 * The entry point `fetchAsReadableText` accepts a `strategy` flag:
 *   - 'fast'    → delegate to existing `fetchPublicWebPage`
 *   - 'browser' → use the Playwright pool to render the page
 *   - undefined → fast first, then auto-upgrade to browser if the fast
 *                 excerpt is empty/short and the body contains `<script>`
 *
 * Strategy decisions per host are cached for 10 minutes.
 */

export type FetchStrategy = 'fast' | 'browser'

export interface FetchOptions {
  signal?: AbortSignal
  mode?: BrowserMode
  strategy?: FetchStrategy
  /**
   * When true, force a refresh of the strategy cache for this host before
   * fetching. Useful for retry paths.
   */
  bypassCache?: boolean
  /** Used for per-user CAPTCHA budget enforcement. */
  userId?: string
}

interface CachedStrategy {
  strategy: FetchStrategy
  expiresAt: number
  reason: string
}

const STRATEGY_CACHE_TTL_MS = 10 * 60 * 1000
const UPGRADE_THRESHOLD_CHARS = 200
const UPGRADE_SCRIPT_THRESHOLD = 3
const KNOWN_STATIC_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'gitee.com',
  'docs.python.org',
  'developer.mozilla.org',
  'en.wikipedia.org',
  'news.ycombinator.com',
  'stackexchange.com',
  'stackoverflow.com',
  'serverfault.com',
  'superuser.com',
])

const strategyCache = new Map<string, CachedStrategy>()

function hostFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function getCachedStrategy(host: string): CachedStrategy | null {
  const entry = strategyCache.get(host)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    strategyCache.delete(host)
    return null
  }
  return entry
}

function setCachedStrategy(host: string, strategy: FetchStrategy, reason: string): void {
  strategyCache.set(host, {
    strategy,
    expiresAt: Date.now() + STRATEGY_CACHE_TTL_MS,
    reason,
  })
}

/** Test helper — clear the strategy cache. */
export function clearStrategyCache(): void {
  strategyCache.clear()
}

function isKnownStaticHost(host: string): boolean {
  return KNOWN_STATIC_HOSTS.has(host) || KNOWN_STATIC_HOSTS.has(host.replace(/^www\./, ''))
}

/**
 * Detect whether a `fetchPublicWebPage` response looks JS-only: short excerpt,
 * a meaningful number of script tags, and no usable semantic markup. This is
 * the signal that the page is an SPA / viewer and the browser-grade fetch is
 * required. We exclude hosts that are known to serve readable static content.
 */
export function responseLooksJsRequired(rawBody: string | null, excerpt: string | null): boolean {
  if (!rawBody && !excerpt) return false
  const scriptCount = rawBody ? (rawBody.match(/<script\b/gi) ?? []).length : 0
  const excerptLen = excerpt ? excerpt.length : 0
  const hasSemanticMarkup = Boolean(rawBody && (rawBody.match(/<(main|article|section)\b/gi) ?? []).length > 0)
  return scriptCount >= UPGRADE_SCRIPT_THRESHOLD && excerptLen < UPGRADE_THRESHOLD_CHARS && !hasSemanticMarkup
}

/**
 * Public entry point. Returns the same `MessageSource` shape as
 * `fetchPublicWebPage` so callers don't have to special-case.
 */
export async function fetchAsReadableText(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<MessageSource | null> {
  const fallbackTitle = options.mode ? `${options.mode} ${new URL(rawUrl).hostname}` : new URL(rawUrl).hostname
  if (options.strategy === 'fast') {
    return await fetchPublicWebPage(rawUrl, fallbackTitle, { signal: options.signal })
  }

  const host = hostFromUrl(rawUrl)
  if (!host) {
    return await fetchPublicWebPage(rawUrl, fallbackTitle, { signal: options.signal })
  }

  // Decide strategy. If the caller pre-cached 'browser', honor it.
  if (options.strategy === 'browser') {
    if (options.bypassCache) {
      setCachedStrategy(host, 'browser', 'forced')
    } else if (!getCachedStrategy(host)) {
      setCachedStrategy(host, 'browser', 'forced')
    }
    return await fetchViaBrowser(rawUrl, options, fallbackTitle)
  }

  // For hosts known to be static content, skip the browser upgrade and avoid
  // launching Chromium just to re-render the same readable HTML.
  if (!options.bypassCache && isKnownStaticHost(host)) {
    const fastResult = await fetchPublicWebPage(rawUrl, fallbackTitle, { signal: options.signal })
    if (fastResult) {
      setCachedStrategy(host, 'fast', 'known-static')
      return fastResult
    }
  }

  // Auto-detect: try fast first; if it returns nothing or the result is too
  // short, retry via browser.
  if (!options.bypassCache) {
    const cached = getCachedStrategy(host)
    if (cached?.strategy === 'browser') {
      return await fetchViaBrowser(rawUrl, options, fallbackTitle)
    }
  }

  const fastResult = await fetchPublicWebPage(rawUrl, fallbackTitle, { signal: options.signal })
  if (fastResult) {
    const excerpt = fastResult.excerpt ?? fastResult.content ?? ''
    if (excerpt.length >= UPGRADE_THRESHOLD_CHARS) {
      setCachedStrategy(host, 'fast', 'got-content')
      return fastResult
    }

    // If the site is known static or the response lacks JS-only signals,
    // don't waste a browser cycle on a short excerpt.
    const rawBody = typeof fastResult === 'object' && 'rawBody' in fastResult
      ? String((fastResult as { rawBody?: unknown }).rawBody || '') || null
      : null
    if (isKnownStaticHost(host) || !responseLooksJsRequired(rawBody, excerpt)) {
      setCachedStrategy(host, 'fast', 'known-static-or-semantic')
      return fastResult
    }
  }

  // Upgrade to browser.
  const browserResult = await fetchViaBrowser(rawUrl, options, fallbackTitle)
  if (browserResult) {
    setCachedStrategy(host, 'browser', 'needed-rendering')
    return browserResult
  }

  // Browser failed. Don't cache 'fast' because the failure might be transient
  // (browser not installed, display unavailable). Leave the cache unset so the
  // next request retries the browser path, but still return the fast result if
  // we have one.
  return fastResult
}

/**
 * Browser-grade path. Uses the managed UWAF pool so that browser fetches share
 * display infrastructure, proxy rules, stealth fingerprints, and the user's
 * persistent identity. Falls back to an ephemeral Chromium only if the pool is
 * not available or the caller explicitly requests a transient browser.
 *
 * If the rendered text looks like a Cloudflare / DDoS-Guard interstitial,
 * attempt a CAPTCHA solve via `solveCaptchaIfConfigured` (only fires when
 * the operator has configured CAPTCHA_PROVIDER + CAPTCHA_API_KEY).
 */
/**
 * Try to reuse the managed UWAF pool for an automatic browser fetch. Tests
 * and headless environments may not have the pool (Xvfb/Chromium), so this
 * helper falls back to the ephemeral Chromium path without surfacing pool
 * failures to the caller.
 */
async function tryGetPoolPage(contextId: string, mode: BrowserMode): Promise<import('playwright-core').Page | null> {
  try {
    const { getPage } = await import('./uwaf-pool')
    return await getPage(contextId, mode)
  } catch (poolError) {
    console.debug('[web-fetch-strategy] UWAF pool unavailable, falling back to ephemeral Chromium:', poolError instanceof Error ? poolError.message : String(poolError))
    return null
  }
}

export async function fetchViaBrowser(
  rawUrl: string,
  options: FetchOptions,
  fallbackTitle?: string,
): Promise<MessageSource | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  const contextId = options.userId
    ? `${options.userId}:${options.mode ?? 'direct'}:web-fetch:${url.hostname}`
    : `anonymous:${options.mode ?? 'direct'}:web-fetch:${url.hostname}`

  let page: import('playwright-core').Page | null = null
  let usedManagedPool = false

  // Try the managed UWAF pool first. It gives us the same display/VNC/proxy
  // stack that live browser sessions use, and it reuses the user's identity.
  if (!options.bypassCache) {
    page = await tryGetPoolPage(contextId, options.mode ?? 'direct')
    usedManagedPool = Boolean(page)

    if (page) {
      const response = await page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      }).catch(() => null)

      if (response === null || response.status() >= 400) {
        // If the managed session is broken, close it and fall back.
        const { closeContext } = await import('./uwaf-pool')
        await closeContext(contextId).catch(() => {})
        page = null
        usedManagedPool = false
      }
    }
  }

  // In tests the managed UWAF pool may not exist (no display/Chromium). Fall
  // back to the isolated ephemeral Chromium path when the pool call fails or
  // when the caller explicitly opts out.
  if (!page) {
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
    }).catch(() => null)
    if (!browser) return null

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
      })

      page = await context.newPage()
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 5_000 }).catch(() => null)
    } catch {
      await browser.close().catch(() => {})
      return null
    }
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => null)
    await page.waitForTimeout(250)

    let text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (looksLikeChallengePage(text)) {
      text = `[Challenge page detected. The site requires CAPTCHA. Configure CAPTCHA_PROVIDER to auto-solve.]`
    }
    const title = (await page.title().catch(() => '')) || fallbackTitle || url.hostname
    const trimmed = text.trim()
    if (!trimmed) return null

    const excerpt = trimmed.length > 3000 ? trimmed.slice(0, 3000) : trimmed
    return {
      filename: title,
      title,
      url: url.href,
      excerpt,
      content: trimmed,
      score: 1,
      mode: 'web',
    }
  } catch (error) {
    console.warn('[web-fetch-strategy] browser path failed:', error instanceof Error ? error.message : String(error))
    return null
  } finally {
    if (!usedManagedPool && page) {
      const context = page.context()
      const browser = context.browser()
      await context.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  }
}

export const __test__ = { strategyCache, getCachedStrategy, setCachedStrategy }
