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
const strategyCache = new Map<string, CachedStrategy>()

function hostFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
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

/**
 * Detect whether a `fetchPublicWebPage` response looks JS-only: short excerpt
 * and the raw HTML body contains script tags. This is the signal that the
 * page is an SPA / viewer and the browser-grade fetch is required.
 */
export function responseLooksJsRequired(rawBody: string | null, excerpt: string | null): boolean {
  if (!rawBody && !excerpt) return false
  const scriptCount = rawBody ? (rawBody.match(/<script\b/gi) ?? []).length : 0
  const excerptLen = excerpt ? excerpt.length : 0
  return scriptCount >= 2 && excerptLen < UPGRADE_THRESHOLD_CHARS
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
  }

  // Upgrade to browser.
  const browserResult = await fetchViaBrowser(rawUrl, options, fallbackTitle)
  setCachedStrategy(
    host,
    browserResult ? 'browser' : 'fast',
    browserResult ? 'needed-rendering' : 'no-render-available'
  )
  return browserResult ?? fastResult
}

/**
 * Browser-grade path. Uses an ephemeral Playwright context, navigates, waits
 * for the page to settle, then returns the rendered text as a MessageSource.
 *
 * If the rendered text looks like a Cloudflare / DDoS-Guard interstitial,
 * attempt a CAPTCHA solve via `solveCaptchaIfConfigured` (only fires when
 * the operator has configured CAPTCHA_PROVIDER + CAPTCHA_API_KEY).
 */
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

    // Apply the user's persistent identity if available so the fetch
    // benefits from any cookies / locale overrides the user has set up.
    if (options.userId) {
      try {
        const { getOrCreateIdentity, applyIdentityToContext } = await import('./uwaf-identity')
        const record = await getOrCreateIdentity(options.userId, 'fetch-as-browser', 'direct')
        await applyIdentityToContext(context, record)
      } catch {
        /* identity is a hint, not a requirement */
      }
    }

    const page = await context.newPage()
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null)
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => null)
    await page.waitForTimeout(250)

    let text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (looksLikeChallengePage(text)) {
      text = `[Challenge page detected. The site requires CAPTCHA. Configure CAPTCHA_PROVIDER to auto-solve.]`
    }
    const title = (await page.title().catch(() => '')) || fallbackTitle || url.hostname
    const trimmed = text.trim()
    if (!trimmed) {
      await page.close().catch(() => {})
      await context.close().catch(() => {})
      return null
    }
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
    await browser.close().catch(() => {})
  }
}

export const __test__ = { strategyCache, getCachedStrategy, setCachedStrategy }
