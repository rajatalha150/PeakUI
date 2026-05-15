import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import net from 'node:net'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

const TOR_PROXY_URL = process.env.TOR_PROXY_URL || 'socks5://localhost:9050'
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

const BROWSER_WIDTH = parseInt(process.env.LIVE_BROWSER_WIDTH || '1280', 10)
const BROWSER_HEIGHT = parseInt(process.env.LIVE_BROWSER_HEIGHT || '720', 10)
const CONTEXT_TTL_MS = 30 * 60 * 1000
const DISPLAY_START = parseInt(process.env.LIVE_BROWSER_DISPLAY_START || '110', 10)
const MAX_DISPLAY_CANDIDATES = parseInt(process.env.LIVE_BROWSER_MAX_DISPLAYS || '200', 10)
const STARTUP_TIMEOUT_MS = parseInt(process.env.LIVE_BROWSER_STARTUP_TIMEOUT_MS || '15000', 10)

const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
]

const DIRECT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export type BrowserMode = 'direct' | 'stealth'

interface ManagedSession {
  browser: Browser
  context: BrowserContext
  activePage: Page | null
  mode: BrowserMode
  display: number
  vncPort: number
  xvfbProcess: ChildProcess
  x11vncProcess: ChildProcess
  createdAt: number
  lastUsed: number
}

const globalForUwafPool = globalThis as typeof globalThis & {
  __peakuiUwafPool?: {
    sessions: Map<string, ManagedSession>
    launchPromises: Map<string, Promise<ManagedSession>>
  }
}

const uwafPoolState = globalForUwafPool.__peakuiUwafPool ??= {
  sessions: new Map<string, ManagedSession>(),
  launchPromises: new Map<string, Promise<ManagedSession>>(),
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomStealthUA(): string {
  return STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)]
}

function logChildProcess(label: string, child: ChildProcess): void {
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim()
    if (text) {
      console.warn(`[uwaf-pool] ${label}: ${text}`)
    }
  })

  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.warn(`[uwaf-pool] ${label} exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    }
  })
}

function spawnProcess(command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  return child
}

async function waitForDisplay(display: number): Promise<void> {
  const socketPath = `/tmp/.X11-unix/X${display}`
  const startedAt = Date.now()

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      await access(socketPath)
      return
    } catch {
      await delay(100)
    }
  }

  throw new Error(`Xvfb did not become ready on display :${display}`)
}

async function waitForTcpPort(port: number): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    const opened = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.destroy()
        resolve(true)
      })

      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })

    if (opened) return
    await delay(100)
  }

  throw new Error(`Port ${port} did not become reachable`)
}

async function allocateVncPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate VNC port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function allocateDisplayNumber(): Promise<number> {
  const usedDisplays = new Set(Array.from(uwafPoolState.sessions.values()).map((session) => session.display))

  for (let offset = 0; offset < MAX_DISPLAY_CANDIDATES; offset += 1) {
    const display = DISPLAY_START + offset
    if (usedDisplays.has(display)) continue

    try {
      await access(`/tmp/.X11-unix/X${display}`)
    } catch {
      return display
    }
  }

  throw new Error('No free Xvfb display numbers available')
}

function buildContextOptions(mode: BrowserMode): Parameters<Browser['newContext']>[0] {
  const options: Parameters<Browser['newContext']>[0] = {
    userAgent: mode === 'stealth' ? randomStealthUA() : DIRECT_USER_AGENT,
    viewport: { width: BROWSER_WIDTH, height: BROWSER_HEIGHT },
    screen: { width: BROWSER_WIDTH, height: BROWSER_HEIGHT },
    locale: 'en-US',
    timezoneId: mode === 'stealth' ? undefined : 'America/New_York',
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
  }

  if (mode === 'stealth') {
    options.proxy = { server: TOR_PROXY_URL }
    options.permissions = []
    options.geolocation = undefined
  }

  return options
}

function buildStealthLandingHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stealth Browser Ready</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1020;
        --panel: rgba(15, 23, 42, 0.88);
        --border: rgba(168, 85, 247, 0.35);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #a855f7;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(168, 85, 247, 0.18), transparent 35%),
          linear-gradient(180deg, #0f172a 0%, var(--bg) 100%);
        color: var(--text);
      }
      .panel {
        width: min(760px, calc(100vw - 64px));
        border: 1px solid var(--border);
        background: var(--panel);
        border-radius: 20px;
        padding: 28px 32px;
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.45);
      }
      .eyebrow {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(168, 85, 247, 0.15);
        color: #d8b4fe;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 10px;
        font-size: 32px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.55;
      }
      .grid {
        margin-top: 20px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .card {
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 14px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.55);
      }
      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .value {
        margin-top: 8px;
        font-size: 15px;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <span class="eyebrow">Stealth Mode</span>
      <h1>Tor-routed browser session is ready.</h1>
      <p>This live browser is configured for Stealth mode. The AI can browse public sites through Tor, search Ahmia for onion discovery, and open <code>.onion</code> pages in the same visible session.</p>
      <section class="grid">
        <div class="card">
          <div class="label">Routing</div>
          <div class="value">Tor SOCKS proxy</div>
        </div>
        <div class="card">
          <div class="label">Search</div>
          <div class="value">Ahmia for Stealth</div>
        </div>
        <div class="card">
          <div class="label">Onion Support</div>
          <div class="value">Enabled</div>
        </div>
      </section>
    </main>
  </body>
</html>`
}

async function applyStealthInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    const originalQuery = window.navigator.permissions?.query
    if (originalQuery) {
      Object.defineProperty(navigator.permissions, 'query', {
        value: (params: PermissionDescriptor) =>
          params?.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(params),
      })
    }
  })
}

async function terminateChildProcess(child: ChildProcess | null | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    delay(2000).then(() => false),
  ]).catch(() => false)

  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await new Promise<void>((resolve) => child.once('exit', () => resolve())).catch(() => {})
  }
}

async function closeManagedSession(contextId: string): Promise<void> {
  const managed = uwafPoolState.sessions.get(contextId)
  if (!managed) return

  uwafPoolState.sessions.delete(contextId)

  await managed.context.close().catch(() => {})
  await managed.browser.close().catch(() => {})
  await terminateChildProcess(managed.x11vncProcess)
  await terminateChildProcess(managed.xvfbProcess)
}

async function focusPage(managed: ManagedSession, page: Page): Promise<Page> {
  if (page.isClosed()) return page
  managed.activePage = page
  await page.bringToFront().catch(() => {})
  return page
}

async function createManagedSession(contextId: string, mode: BrowserMode): Promise<ManagedSession> {
  const display = await allocateDisplayNumber()
  const vncPort = await allocateVncPort()
  const displayEnv = `:${display}`

  const xvfbProcess = spawnProcess('Xvfb', [
    displayEnv,
    '-screen', '0', `${BROWSER_WIDTH}x${BROWSER_HEIGHT}x24`,
    '-ac',
    '-nolisten', 'tcp',
  ])
  logChildProcess(`Xvfb ${displayEnv}`, xvfbProcess)

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let x11vncProcess: ChildProcess | null = null

  try {
    await waitForDisplay(display)

    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: false,
      env: {
        ...process.env,
        DISPLAY: displayEnv,
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--window-position=0,0',
        `--window-size=${BROWSER_WIDTH},${BROWSER_HEIGHT}`,
      ],
    })

    context = await browser.newContext(buildContextOptions(mode))

    if (mode === 'stealth') {
      await applyStealthInitScript(context)
    }

    let activePage: Page | null = null
    const page = await context.newPage()
    activePage = page

    if (mode === 'stealth') {
      await page.setContent(buildStealthLandingHtml(), { waitUntil: 'domcontentloaded' }).catch(() => {})
    }

    context.on('page', (nextPage) => {
      activePage = nextPage
      nextPage.once('close', () => {
        if (activePage === nextPage) {
          activePage = context?.pages().find(candidate => !candidate.isClosed()) ?? null
        }
      })
      void nextPage.bringToFront().catch(() => {})
    })

    await page.bringToFront().catch(() => {})

    x11vncProcess = spawnProcess('x11vnc', [
      '-display', displayEnv,
      '-rfbport', String(vncPort),
      '-forever',
      '-shared',
      '-xkb',
      '-noxdamage',
      '-nowf',
      '-nowcr',
      '-noscr',
      '-cursor', 'arrow',
      '-localhost',
      '-nopw',
    ])
    logChildProcess(`x11vnc ${displayEnv}`, x11vncProcess)
    await waitForTcpPort(vncPort)

    const managed: ManagedSession = {
      browser,
      context,
      get activePage() {
        return activePage
      },
      set activePage(pageValue: Page | null) {
        activePage = pageValue
      },
      mode,
      display,
      vncPort,
      xvfbProcess,
      x11vncProcess,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    }

    browser.on('disconnected', () => {
      console.warn(`[uwaf-pool] Browser disconnected for ${contextId}`)
      void closeManagedSession(contextId)
    })

    uwafPoolState.sessions.set(contextId, managed)
    return managed
  } catch (error) {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await terminateChildProcess(x11vncProcess)
    await terminateChildProcess(xvfbProcess)
    throw error
  }
}

async function ensureManagedSession(contextId: string, mode: BrowserMode): Promise<ManagedSession> {
  const existing = uwafPoolState.sessions.get(contextId)
  if (existing) {
    const expired = Date.now() - existing.lastUsed > CONTEXT_TTL_MS
    const disconnected = !existing.browser.isConnected()
    if (!expired && !disconnected && existing.mode === mode) {
      existing.lastUsed = Date.now()
      return existing
    }
    await closeManagedSession(contextId)
  }

  const launchPromise = uwafPoolState.launchPromises.get(contextId)
  if (launchPromise) {
    const launched = await launchPromise
    if (launched.mode === mode) {
      launched.lastUsed = Date.now()
      return launched
    }
    await closeManagedSession(contextId)
  }

  const nextLaunch = createManagedSession(contextId, mode)
    .finally(() => {
      uwafPoolState.launchPromises.delete(contextId)
    })

  uwafPoolState.launchPromises.set(contextId, nextLaunch)
  return nextLaunch
}

export async function getPage(contextId: string, mode: BrowserMode): Promise<Page> {
  const managed = await ensureManagedSession(contextId, mode)
  managed.lastUsed = Date.now()

  const pages = managed.context.pages()
  const activePage = managed.activePage && !managed.activePage.isClosed()
    ? managed.activePage
    : null

  if (activePage) {
    return focusPage(managed, activePage)
  }

  const visiblePage = [...pages].reverse().find(page => !page.isClosed() && page.url() !== 'about:blank')
    ?? [...pages].reverse().find(page => !page.isClosed())

  if (visiblePage) {
    return focusPage(managed, visiblePage)
  }

  const page = await managed.context.newPage()
  return focusPage(managed, page)
}

export async function getLiveBrowserInfo(contextId: string, mode: BrowserMode): Promise<{
  vncPort: number
  viewport: { width: number; height: number }
}> {
  const managed = await ensureManagedSession(contextId, mode)
  managed.lastUsed = Date.now()
  return {
    vncPort: managed.vncPort,
    viewport: {
      width: BROWSER_WIDTH,
      height: BROWSER_HEIGHT,
    },
  }
}

export async function closeContext(contextId: string): Promise<void> {
  await closeManagedSession(contextId)
}

async function withEphemeralBrowser<T>(
  contextOptions: Parameters<Browser['newContext']>[0],
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  })

  const context = await browser.newContext(contextOptions)

  try {
    return await fn(context)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

export async function checkTorProxyStatus(): Promise<{ reachable: boolean; error?: string }> {
  try {
    return await withEphemeralBrowser({
      proxy: { server: TOR_PROXY_URL },
      userAgent: randomStealthUA(),
    }, async (context) => {
      const page = await context.newPage()
      await page.goto('https://check.torproject.org/api/ip', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      })
      const content = await page.textContent('body')
      if (!content) {
        return { reachable: false, error: 'Empty response from Tor check service' }
      }

      try {
        const data = JSON.parse(content)
        if (data.IsTor) {
          return { reachable: true }
        }
        return { reachable: false, error: 'Connected but not using Tor exit node' }
      } catch {
        return { reachable: false, error: 'Invalid response from Tor check service' }
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { reachable: false, error: `Tor proxy unreachable: ${message}` }
  }
}

export async function getDirectIp(): Promise<string> {
  try {
    return await withEphemeralBrowser({
      userAgent: DIRECT_USER_AGENT,
    }, async (context) => {
      const page = await context.newPage()
      await page.goto('https://api.ipify.org?format=text', {
        timeout: 10000,
        waitUntil: 'domcontentloaded',
      })
      return (await page.textContent('body'))?.trim() || 'unknown'
    })
  } catch {
    return 'unavailable'
  }
}

async function lookupTorExitCountry(context: BrowserContext, ip: string): Promise<string> {
  try {
    const page = await context.newPage()
    await page.goto('https://ifconfig.co/json', {
      timeout: 15000,
      waitUntil: 'domcontentloaded',
    })
    const content = await page.textContent('body')
    await page.close().catch(() => {})
    if (!content) return 'unknown'
    const data = JSON.parse(content)
    const byIp = typeof data?.ip === 'string' && data.ip.trim() === ip
    if (!byIp) return 'unknown'
    const country = data?.country_iso || data?.country || 'unknown'
    return typeof country === 'string' && country.trim() ? country.trim() : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function getStealthInfo(): Promise<{ ip: string; country: string; isTor: boolean } | null> {
  try {
    return await withEphemeralBrowser({
      proxy: { server: TOR_PROXY_URL },
      userAgent: randomStealthUA(),
    }, async (context) => {
      const page = await context.newPage()
      await page.goto('https://check.torproject.org/api/ip', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      })
      const content = await page.textContent('body')
      if (!content) return null
      const data = JSON.parse(content)
      const ip = data.IP || 'unknown'
      return {
        ip,
        country: data.CountryCode || await lookupTorExitCountry(context, ip),
        isTor: data.IsTor === true,
      }
    })
  } catch {
    return null
  }
}

export async function shutdownPlaywright(): Promise<void> {
  const activeSessionIds = Array.from(uwafPoolState.sessions.keys())
  uwafPoolState.launchPromises.clear()

  for (const contextId of activeSessionIds) {
    await closeManagedSession(contextId)
  }
}
