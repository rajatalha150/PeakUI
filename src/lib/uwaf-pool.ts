import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

const TOR_PROXY_URL = process.env.TOR_PROXY_URL || 'socks5://localhost:9050'
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
]

const DIRECT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export type BrowserMode = 'direct' | 'stealth'

interface ManagedContext {
  context: BrowserContext
  mode: BrowserMode
  createdAt: number
  lastUsed: number
}

let browserInstance: Browser | null = null
let browserLaunchPromise: Promise<Browser> | null = null
const contexts = new Map<string, ManagedContext>()
const CONTEXT_TTL_MS = 30 * 60 * 1000 // 30 minutes

async function launchBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance

  if (browserLaunchPromise) return browserLaunchPromise

  browserLaunchPromise = chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
      '--no-zygote',
    ],
    headless: true,
  })

  try {
    browserInstance = await browserLaunchPromise
    return browserInstance
  } catch (error) {
    browserLaunchPromise = null
    throw error
  } finally {
    browserLaunchPromise = null
  }
}

function randomStealthUA(): string {
  return STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)]
}

export async function createContext(contextId: string, mode: BrowserMode): Promise<BrowserContext> {
  const browser = await launchBrowser()

  const contextOptions: Parameters<Browser['newContext']>[0] = {
    userAgent: mode === 'stealth' ? randomStealthUA() : DIRECT_USER_AGENT,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: mode === 'stealth' ? undefined : 'America/New_York',
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
  }

  if (mode === 'stealth') {
    contextOptions.proxy = { server: TOR_PROXY_URL }
    contextOptions.permissions = []
    contextOptions.geolocation = undefined
  }

  const context = await browser.newContext(contextOptions)

  if (mode === 'stealth') {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      const originalQuery = window.navigator.permissions?.query
      if (originalQuery) {
        Object.defineProperty(navigator.permissions, 'query', {
          value: (params: any) =>
            params?.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
              : originalQuery(params),
        })
      }
    })
  }

  contexts.set(contextId, {
    context,
    mode,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  })

  return context
}

export async function getPage(contextId: string, mode: BrowserMode): Promise<Page> {
  let managed = contexts.get(contextId)

  if (!managed || managed.mode !== mode || Date.now() - managed.lastUsed > CONTEXT_TTL_MS) {
    if (managed) {
      await managed.context.close().catch(() => {})
      contexts.delete(contextId)
    }
    const ctx = await createContext(contextId, mode)
    managed = contexts.get(contextId)!
  }

  managed.lastUsed = Date.now()

  const pages = managed.context.pages()
  if (pages.length > 0) return pages[pages.length - 1]

  return managed.context.newPage()
}

export async function closeContext(contextId: string): Promise<void> {
  const managed = contexts.get(contextId)
  if (managed) {
    await managed.context.close().catch(() => {})
    contexts.delete(contextId)
  }
}

export async function checkTorProxyStatus(): Promise<{ reachable: boolean; error?: string }> {
  try {
    const browser = await launchBrowser()
    const context = await browser.newContext({
      proxy: { server: TOR_PROXY_URL },
      userAgent: randomStealthUA(),
    })
    const page = await context.newPage()

    try {
      await page.goto('https://check.torproject.org/api/ip', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      })
      const content = await page.textContent('body')
      if (content) {
        try {
          const data = JSON.parse(content)
          if (data.IsTor) {
            return { reachable: true }
          }
          return { reachable: false, error: 'Connected but not using Tor exit node' }
        } catch {
          return { reachable: false, error: 'Invalid response from Tor check service' }
        }
      }
      return { reachable: false, error: 'Empty response from Tor check service' }
    } finally {
      await context.close()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { reachable: false, error: `Tor proxy unreachable: ${message}` }
  }
}

export async function getDirectIp(): Promise<string> {
  try {
    const browser = await launchBrowser()
    const context = await browser.newContext({ userAgent: DIRECT_USER_AGENT })
    const page = await context.newPage()
    try {
      await page.goto('https://api.ipify.org?format=text', {
        timeout: 10000,
        waitUntil: 'domcontentloaded',
      })
      const ip = (await page.textContent('body'))?.trim() || 'unknown'
      return ip
    } finally {
      await context.close()
    }
  } catch {
    return 'unavailable'
  }
}

export async function getStealthInfo(): Promise<{ ip: string; country: string } | null> {
  try {
    const browser = await launchBrowser()
    const context = await browser.newContext({
      proxy: { server: TOR_PROXY_URL },
      userAgent: randomStealthUA(),
    })
    const page = await context.newPage()
    try {
      await page.goto('https://check.torproject.org/api/ip', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      })
      const content = await page.textContent('body')
      if (content) {
        const data = JSON.parse(content)
        return {
          ip: data.IP || 'unknown',
          country: data.CountryCode || 'unknown',
        }
      }
      return null
    } finally {
      await context.close()
    }
  } catch {
    return null
  }
}

export async function shutdownPlaywright(): Promise<void> {
  const closables = Array.from(contexts.values())
  contexts.clear()

  for (const managed of closables) {
    await managed.context.close().catch(() => {})
  }

  if (browserInstance) {
    await browserInstance.close().catch(() => {})
    browserInstance = null
  }
}

export function getManagedContext(contextId: string): ManagedContext | undefined {
  return contexts.get(contextId)
}