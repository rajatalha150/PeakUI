import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import net from 'node:net'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { logUwafSessionCrash, recordUwafLaunchTime } from './uwaf-telemetry'
import {
  buildStealthFingerprint,
  getDefaultStealthProfile,
  getStealthProfileDefinition,
  normalizeStealthProfile,
  type StealthFingerprint,
  type StealthProfile,
} from './uwaf-fingerprint'
import { getStealthProviderLabels } from './uwaf-search-providers'

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

const DEFAULT_TOR_PROXY_CANDIDATES = [
  'socks5://localhost:9050',      // Linux/macOS host-mode Docker Compose
  'socks5://tor-proxy:9150',      // Windows Docker Desktop bridge network
]

let cachedTorProxyUrl: string | null = null

async function probeSocks5Proxy(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    const port = Number(parsed.port)
    if (!hostname || !Number.isFinite(port)) return false
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: hostname, port }, () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', reject)
      socket.setTimeout(timeoutMs, () => {
        socket.destroy()
        reject(new Error('Timeout'))
      })
    })
    return true
  } catch {
    return false
  }
}

/**
 * Return the configured Tor proxy URL, or auto-detect a working default.
 * Linux host-mode uses localhost:9050; Windows Docker Desktop bridge uses
 * tor-proxy:9150. An explicit TOR_PROXY_URL is preferred, but if it is not
 * reachable we fall back to probing the built-in candidates.
 */
export async function getTorProxyUrl(): Promise<string> {
  const configured = process.env.TOR_PROXY_URL?.trim()
  if (configured && cachedTorProxyUrl === configured) {
    return configured
  }

  // If a proxy is already known to be reachable, reuse it.
  if (cachedTorProxyUrl) {
    if (await probeSocks5Proxy(cachedTorProxyUrl)) {
      return cachedTorProxyUrl
    }
    cachedTorProxyUrl = null
  }

  // Prefer the explicit setting, but verify it is actually reachable.
  if (configured) {
    if (await probeSocks5Proxy(configured)) {
      cachedTorProxyUrl = configured
      return configured
    }
    console.warn(`[uwaf-pool] Configured TOR_PROXY_URL ${configured} is not reachable, trying auto-detection.`)
  }

  for (const candidate of DEFAULT_TOR_PROXY_CANDIDATES) {
    if (await probeSocks5Proxy(candidate)) {
      cachedTorProxyUrl = candidate
      console.log(`[uwaf-pool] Auto-detected Tor proxy: ${candidate}`)
      return candidate
    }
  }

  // Fallback to the Linux default so callers still have a URL to attempt; the
  // failure will be reported clearly by the preflight/onion check.
  cachedTorProxyUrl = DEFAULT_TOR_PROXY_CANDIDATES[0]
  return cachedTorProxyUrl
}

const BROWSER_WIDTH = parseInt(process.env.LIVE_BROWSER_WIDTH || '1280', 10)
const BROWSER_HEIGHT = parseInt(process.env.LIVE_BROWSER_HEIGHT || '720', 10)
const CONTEXT_TTL_MS = 10 * 60 * 1000
const DISPLAY_START = parseInt(process.env.LIVE_BROWSER_DISPLAY_START || '110', 10)
const MAX_DISPLAY_CANDIDATES = parseInt(process.env.LIVE_BROWSER_MAX_DISPLAYS || '200', 10)
const STARTUP_TIMEOUT_MS = parseInt(process.env.LIVE_BROWSER_STARTUP_TIMEOUT_MS || '15000', 10)
const FINGERPRINT_REGRESSION_TTL_MS = 10 * 60 * 1000
const MAX_MANAGED_SESSIONS = parseInt(process.env.UWAF_MAX_MANAGED_SESSIONS || '16', 10)
const MANAGED_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000

const DIRECT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36'

export type BrowserMode = 'direct' | 'stealth'

export interface StealthPreflightResult {
  ok: boolean
  profile: StealthProfile
  fingerprintId: string
  checkedAt: string
  directIp: string
  torExitIp: string
  torExitCountry: string
  torReachable: boolean
  torIsReady: boolean
  exitDiffersFromDirect: boolean
  dnsLeakVerified: boolean
  dnsLeakDetected: boolean
  dnsResolverIps: string[]
  webrtcExposed: boolean
  udpLeakProtected: boolean
  runtimeProtectionVerified: boolean
  fingerprintRegressionPassed: boolean
  fingerprintRegressionWarnings: string[]
  fingerprintDetectors: StealthFingerprintDetectorResult[]
  warnings: string[]
  error?: string
}

export interface StealthFingerprintDetectorResult {
  id: string
  label: string
  ok: boolean
  warning?: string
  details?: string
}

export interface OnionResolutionResult {
  ok: boolean
  checkedAt: string
  url: string
  hostname: string
  httpStatus?: number
  finalUrl?: string
  error?: string
  failureCode?: 'invalid_onion_host' | 'tor_unavailable' | 'onion_not_found' | 'connection_refused' | 'timeout' | 'empty_response' | 'navigation_failed'
}

interface ManagedSession {
  browser: Browser
  context: BrowserContext
  activePage: Page | null
  mode: BrowserMode
  stealthProfile: StealthProfile
  fingerprint?: StealthFingerprint
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

let managedSessionCleanupInterval: ReturnType<typeof setInterval> | null = null

function startManagedSessionCleanup(): void {
  if (managedSessionCleanupInterval) return
  managedSessionCleanupInterval = setInterval(() => {
    void cleanupStaleManagedSessions()
  }, MANAGED_SESSION_CLEANUP_INTERVAL_MS)
  managedSessionCleanupInterval.unref?.()
}

function stopManagedSessionCleanup(): void {
  if (managedSessionCleanupInterval) {
    clearInterval(managedSessionCleanupInterval)
    managedSessionCleanupInterval = null
  }
}

async function cleanupStaleManagedSessions(): Promise<void> {
  const now = Date.now()
  const stale: string[] = []
  for (const [contextId, managed] of uwafPoolState.sessions) {
    if (now - managed.lastUsed > CONTEXT_TTL_MS) {
      stale.push(contextId)
    }
  }
  for (const contextId of stale) {
    await closeManagedSession(contextId).catch(() => {})
  }
}

function evictOldestManagedSessionIfNeeded(): void {
  if (uwafPoolState.sessions.size < MAX_MANAGED_SESSIONS) return
  let oldest: { contextId: string; lastUsed: number } | null = null
  for (const [contextId, managed] of uwafPoolState.sessions) {
    if (!oldest || managed.lastUsed < oldest.lastUsed) {
      oldest = { contextId, lastUsed: managed.lastUsed }
    }
  }
  if (oldest) {
    closeManagedSession(oldest.contextId).catch(() => {})
  }
}

const STEALTH_PREFLIGHT_TTL_MS = 2 * 60 * 1000
const stealthPreflightCache = new Map<StealthProfile, { value: StealthPreflightResult; expiresAt: number }>()
const stealthPreflightPromises = new Map<StealthProfile, Promise<StealthPreflightResult>>()
const fingerprintRegressionCache = new Map<StealthProfile, { value: Pick<StealthPreflightResult, 'fingerprintRegressionPassed' | 'fingerprintRegressionWarnings' | 'fingerprintDetectors'>; expiresAt: number }>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function buildContextOptions(
  mode: BrowserMode,
  input?: { profile?: StealthProfile; fingerprint?: StealthFingerprint },
): Promise<Parameters<Browser['newContext']>[0]> {
  const profile = normalizeStealthProfile(input?.profile)
  const fingerprint = mode === 'stealth'
    ? (input?.fingerprint || buildStealthFingerprint(profile, `ephemeral:${Date.now()}`))
    : null
  const contextOptions: Parameters<Browser['newContext']>[0] = {
    userAgent: fingerprint?.userAgent || DIRECT_USER_AGENT,
    viewport: fingerprint?.viewport || { width: BROWSER_WIDTH, height: BROWSER_HEIGHT },
    screen: fingerprint?.screen || { width: BROWSER_WIDTH, height: BROWSER_HEIGHT },
    deviceScaleFactor: fingerprint?.deviceScaleFactor ?? 1,
    locale: fingerprint?.locale || 'en-US',
    timezoneId: fingerprint?.timezoneId || 'America/New_York',
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    colorScheme: fingerprint?.colorScheme || 'light',
    reducedMotion: fingerprint?.reducedMotion || 'no-preference',
  }

  if (mode === 'stealth') {
    contextOptions.proxy = { server: await getTorProxyUrl() }
    contextOptions.permissions = []
    contextOptions.geolocation = undefined
  }

  return contextOptions
}

function buildChromiumLaunchArgs(mode: BrowserMode, profile: StealthProfile): string[] {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
  ]
  const disabledFeatures: string[] = []

  if (mode === 'stealth') {
    args.push(
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    )
    disabledFeatures.push('WebRtcHideLocalIpsWithMdns')
    for (const arg of getStealthProfileDefinition(profile).launchArgs) {
      if (arg.startsWith('--disable-features=')) {
        disabledFeatures.push(...arg.replace('--disable-features=', '').split(',').filter(Boolean))
      } else {
        args.push(arg)
      }
    }
  }

  if (disabledFeatures.length > 0) {
    args.push(`--disable-features=${Array.from(new Set(disabledFeatures)).join(',')}`)
  }

  return args
}

function classifyOnionResolutionError(message: string): Pick<OnionResolutionResult, 'failureCode' | 'error'> {
  const lower = message.toLowerCase()
  if (lower.includes('err_name_not_resolved') || lower.includes('host not found')) {
    return {
      failureCode: 'onion_not_found',
      error: 'Tor could not resolve this .onion hostname. The address may be offline, expired, mistyped, or no longer published.',
    }
  }
  if (lower.includes('socks') || lower.includes('proxy') || lower.includes('tor')) {
    return {
      failureCode: 'tor_unavailable',
      error: `Tor proxy failed while resolving the .onion hostname: ${message}`,
    }
  }
  if (lower.includes('err_connection_refused') || lower.includes('err_connection_closed')) {
    return {
      failureCode: 'connection_refused',
      error: 'The .onion hostname resolved through Tor, but the remote service refused or closed the connection.',
    }
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      failureCode: 'timeout',
      error: 'Timed out while resolving or connecting to the .onion service through Tor.',
    }
  }
  if (lower.includes('err_empty_response') || lower.includes('empty response')) {
    return {
      failureCode: 'empty_response',
      error: 'The .onion hostname resolved, but the server returned an empty response. The hidden service may be offline or overloaded.',
    }
  }
  return {
    failureCode: 'navigation_failed',
    error: `Unable to reach the .onion service through Tor: ${message}`,
  }
}

function parseOnionUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl)
    return parsed.hostname.endsWith('.onion') ? parsed : null
  } catch {
    return null
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

function buildStealthLandingHtml(profile: StealthProfile): string {
  const providers = getStealthProviderLabels(profile).join(', ')
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
      <p>This live browser is configured for Stealth mode. The AI can browse public sites through Tor, rotate across stealth-safe search providers (${providers}), and open <code>.onion</code> pages in the same visible session.</p>
      <section class="grid">
        <div class="card">
          <div class="label">Routing</div>
          <div class="value">Tor SOCKS proxy</div>
        </div>
        <div class="card">
          <div class="label">Search</div>
          <div class="value">${providers}</div>
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

async function applyStealthInitScript(
  context: BrowserContext,
  fingerprint: StealthFingerprint,
  profile: StealthProfile,
): Promise<void> {
  await context.addInitScript(({ config, activeProfile }) => {
    const makeArrayLike = <T extends object>(items: T[]) => {
      const copy = items.map(item => ({ ...item }))
      const arrayLike = Object.create(Array.prototype)
      for (const [index, item] of copy.entries()) {
        Object.defineProperty(arrayLike, index, {
          value: item,
          enumerable: true,
        })
      }
      Object.defineProperty(arrayLike, 'length', { value: copy.length })
      Object.defineProperty(arrayLike, 'item', { value: (index: number) => copy[index] || null })
      Object.defineProperty(arrayLike, 'namedItem', {
        value: (name: string) => copy.find(item => 'type' in item ? (item as { type?: string }).type === name : (item as { name?: string }).name === name) || null,
      })
      return arrayLike
    }

    const pluginEntries = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ]
    const mimeTypeEntries = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ]
    const plugins = makeArrayLike(pluginEntries)
    const mimeTypes = makeArrayLike(mimeTypeEntries)

    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'userAgent', { get: () => config.userAgent })
    Object.defineProperty(navigator, 'platform', { get: () => config.platform })
    Object.defineProperty(navigator, 'vendor', { get: () => config.vendor })
    Object.defineProperty(navigator, 'language', { get: () => config.languages[0] })
    Object.defineProperty(navigator, 'languages', { get: () => [...config.languages] })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => config.hardwareConcurrency })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => config.deviceMemory })
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => config.maxTouchPoints })
    Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => true })
    Object.defineProperty(navigator, 'doNotTrack', { get: () => activeProfile === 'high' ? '1' : null })
    Object.defineProperty(navigator, 'plugins', { get: () => plugins })
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes })
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: config.userAgentData.brands,
        mobile: false,
        platform: config.userAgentData.platform,
        getHighEntropyValues: async (hints: string[]) => {
          const values: Record<string, unknown> = {}
          for (const hint of hints) {
            if (hint === 'architecture') values.architecture = config.userAgentData.architecture
            if (hint === 'bitness') values.bitness = config.userAgentData.bitness
            if (hint === 'model') values.model = ''
            if (hint === 'platform') values.platform = config.userAgentData.platform
            if (hint === 'platformVersion') values.platformVersion = config.userAgentData.platformVersion
            if (hint === 'uaFullVersion') values.uaFullVersion = config.userAgentData.brands[1]?.version || '148.0.0.0'
            if (hint === 'wow64') values.wow64 = config.userAgentData.wow64
          }
          return values
        },
      }),
    })

    Object.defineProperty(window, 'devicePixelRatio', { get: () => config.deviceScaleFactor })
    for (const [target, values] of [[screen, config.screen], [window, config.viewport]] as const) {
      Object.defineProperty(target, 'width', { get: () => values.width })
      Object.defineProperty(target, 'height', { get: () => values.height })
    }
    Object.defineProperty(screen, 'availWidth', { get: () => config.screen.width })
    Object.defineProperty(screen, 'availHeight', { get: () => config.screen.height - 40 })
    Object.defineProperty(window, 'outerWidth', { get: () => config.viewport.width })
    Object.defineProperty(window, 'outerHeight', { get: () => config.viewport.height })

    if (!('chrome' in window)) {
      Object.defineProperty(window, 'chrome', {
        value: {
          runtime: {},
          app: {
            isInstalled: false,
          },
          loadTimes: () => ({}),
          csi: () => ({}),
        },
      })
    }

    Object.defineProperty(window, 'RTCPeerConnection', { get: () => undefined })
    Object.defineProperty(window, 'webkitRTCPeerConnection', { get: () => undefined })
    Object.defineProperty(window, 'mozRTCPeerConnection', { get: () => undefined })
    const originalQuery = window.navigator.permissions?.query
    if (originalQuery) {
      Object.defineProperty(navigator.permissions, 'query', {
        value: (params: PermissionDescriptor) =>
          params?.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(params),
      })
    }
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
        value: async () => [
          { kind: 'audioinput', deviceId: 'default-audio-in', groupId: 'default-audio', label: '' },
          { kind: 'audiooutput', deviceId: 'default-audio-out', groupId: 'default-audio', label: '' },
          { kind: 'videoinput', deviceId: 'default-video-in', groupId: 'default-video', label: '' },
        ],
      })
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => {
          throw new DOMException('Media capture disabled in stealth mode', 'NotAllowedError')
        },
      })
    }

    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        downlink: config.connection.downlink,
        effectiveType: config.connection.effectiveType,
        rtt: config.connection.rtt,
        saveData: config.connection.saveData,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })

    const patchWebGl = (proto: WebGLRenderingContext | WebGL2RenderingContext | null) => {
      if (!proto || !('getParameter' in proto)) return
      const original = proto.getParameter
      Object.defineProperty(proto, 'getParameter', {
        value(this: WebGLRenderingContext, parameter: number) {
          if (parameter === 37445) return config.webglVendor
          if (parameter === 37446) return config.webglRenderer
          return original.call(this, parameter)
        },
      })
    }

    patchWebGl(window.WebGLRenderingContext?.prototype || null)
    patchWebGl(window.WebGL2RenderingContext?.prototype || null)
  }, { config: fingerprint, activeProfile: profile })
}

function extractIpv4s(text: string): string[] {
  const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []
  return Array.from(new Set(matches.filter(ip => ip !== '0.0.0.0')))
}

async function runFingerprintRegressionChecks(
  context: BrowserContext,
  profile: StealthProfile,
): Promise<Pick<StealthPreflightResult, 'fingerprintRegressionPassed' | 'fingerprintRegressionWarnings' | 'fingerprintDetectors'>> {
  const now = Date.now()
  const cached = fingerprintRegressionCache.get(profile)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const detectors: Array<{ id: string; label: string; url: string; evaluator: (bodyText: string) => Omit<StealthFingerprintDetectorResult, 'id' | 'label'> }> = [
    {
      id: 'bot-sannysoft',
      label: 'bot.sannysoft.com',
      url: 'https://bot.sannysoft.com/',
      evaluator: (bodyText) => {
        const lower = bodyText.toLowerCase()
        const failed = lower.includes('webdriver') && (lower.includes('fail') || lower.includes('detected'))
        return {
          ok: !failed,
          warning: failed ? 'SannySoft reported webdriver-style automation markers.' : undefined,
          details: bodyText.slice(0, 240),
        }
      },
    },
    {
      id: 'browserleaks-javascript',
      label: 'browserleaks.com/javascript',
      url: 'https://browserleaks.com/javascript',
      evaluator: (bodyText) => {
        const lower = bodyText.toLowerCase()
        const failed = lower.includes('webdriver') && (lower.includes('true') || lower.includes('detected'))
        return {
          ok: !failed,
          warning: failed ? 'Browserleaks JavaScript page exposed webdriver-like signals.' : undefined,
          details: bodyText.slice(0, 240),
        }
      },
    },
  ]

  const results: StealthFingerprintDetectorResult[] = []
  const warnings: string[] = []

  for (const detector of detectors) {
    const page = await context.newPage()
    try {
      await page.goto(detector.url, {
        timeout: 15_000,
        waitUntil: 'domcontentloaded',
      })
      await page.waitForTimeout(1_250)
      const bodyText = (await page.textContent('body').catch(() => '')) || ''
      const evaluation = detector.evaluator(bodyText)
      results.push({
        id: detector.id,
        label: detector.label,
        ...evaluation,
      })
      if (!evaluation.ok && evaluation.warning) {
        warnings.push(`${detector.label}: ${evaluation.warning}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        id: detector.id,
        label: detector.label,
        ok: false,
        warning: `Detector page unavailable: ${message}`,
      })
      warnings.push(`${detector.label}: detector page unavailable`)
    } finally {
      await page.close().catch(() => {})
    }
  }

  const completedChecks = results.filter(result => !result.warning?.includes('unavailable'))
  const fingerprintRegressionPassed = completedChecks.length > 0 && completedChecks.every(result => result.ok)
  const value = {
    fingerprintRegressionPassed,
    fingerprintRegressionWarnings: warnings,
    fingerprintDetectors: results,
  }

  fingerprintRegressionCache.set(profile, {
    value,
    expiresAt: now + FINGERPRINT_REGRESSION_TTL_MS,
  })

  return value
}

async function verifyStealthRuntimeProtection(context: BrowserContext): Promise<{
  webrtcExposed: boolean
  udpLeakProtected: boolean
  runtimeProtectionVerified: boolean
}> {
  const page = await context.newPage()
  try {
    await page.goto('data:text/html,<html><body>stealth-runtime-check</body></html>', {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    })

    const result = await page.evaluate(async () => {
      const rtcCtor = (window as typeof window & {
        webkitRTCPeerConnection?: unknown
        mozRTCPeerConnection?: unknown
      }).RTCPeerConnection
        || (window as typeof window & { webkitRTCPeerConnection?: unknown }).webkitRTCPeerConnection
        || (window as typeof window & { mozRTCPeerConnection?: unknown }).mozRTCPeerConnection

      const webrtcExposed = typeof rtcCtor !== 'undefined'
      const mediaDevices = navigator.mediaDevices
      let enumerateDevicesCount: number | null = null
      if (mediaDevices?.enumerateDevices) {
        try {
          enumerateDevicesCount = (await mediaDevices.enumerateDevices()).length
        } catch {
          enumerateDevicesCount = null
        }
      }
      let mediaCaptureBlocked = !mediaDevices?.getUserMedia
      if (mediaDevices?.getUserMedia) {
        try {
          const stream = await mediaDevices.getUserMedia({ audio: true, video: true })
          stream.getTracks().forEach(track => track.stop())
          mediaCaptureBlocked = false
        } catch {
          mediaCaptureBlocked = true
        }
      }

      return {
        webrtcExposed,
        mediaDevicesAvailable: Boolean(mediaDevices?.enumerateDevices),
        enumerateDevicesCount,
        mediaCaptureBlocked,
      }
    })

    const mediaDevicesLockedDown = result.mediaCaptureBlocked

    return {
      webrtcExposed: result.webrtcExposed,
      udpLeakProtected: !result.webrtcExposed,
      runtimeProtectionVerified: !result.webrtcExposed && mediaDevicesLockedDown,
    }
  } finally {
    await page.close().catch(() => {})
  }
}

async function runDnsLeakVerification(context: BrowserContext, directIp: string): Promise<{
  dnsLeakVerified: boolean
  dnsLeakDetected: boolean
  dnsResolverIps: string[]
}> {
  const page = await context.newPage()
  try {
    await page.goto('https://browserleaks.com/dns', {
      timeout: 20_000,
      waitUntil: 'domcontentloaded',
    })
    await page.waitForFunction(() => {
      const container = document.querySelector('#dns-container')
      return Boolean(container?.textContent && container.textContent.trim().length > 0)
    }, { timeout: 12_000 }).catch(() => null)
    await page.waitForTimeout(1_500)
    const resolverText = await page.textContent('#dns-container').catch(() => '')
    const dnsResolverIps = extractIpv4s(resolverText || '')
    const dnsLeakDetected = directIp !== 'unknown'
      && directIp !== 'unavailable'
      && dnsResolverIps.includes(directIp)
    return {
      dnsLeakVerified: dnsResolverIps.length > 0 && !dnsLeakDetected,
      dnsLeakDetected,
      dnsResolverIps,
    }
  } finally {
    await page.close().catch(() => {})
  }
}

async function terminateChildProcess(child: ChildProcess | null | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  try {
    child.kill('SIGTERM')
  } catch {
    // Ignore platforms where SIGTERM is unsupported.
  }

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    delay(2000).then(() => false),
  ]).catch(() => false)

  if (!exited && child.exitCode === null && child.signalCode === null) {
    try {
      // Windows does not support SIGKILL natively, but Node falls back to
      // TerminateProcess. Use the default signal on Windows to avoid errors.
      child.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
    } catch {
      // Process may already be gone.
    }
    await new Promise<void>((resolve) => child.once('exit', () => resolve())).catch(() => {})
  }
}

async function closeManagedSession(contextId: string): Promise<void> {
  const managed = uwafPoolState.sessions.get(contextId)
  if (!managed) return

  uwafPoolState.sessions.delete(contextId)

  // Phase 4 of the web-trust plan: flush cookies to the per-user identity
  // jar so a returning direct-mode user keeps their login state.
  if (managed.context && managed.mode === 'direct') {
    try {
      const [userId, sessionId] = contextId.split(':', 2) as [string, string]
      if (userId && sessionId) {
        const { getOrCreateIdentity, saveCookies } = await import('./uwaf-identity')
        const record = await getOrCreateIdentity(userId, sessionId, managed.mode)
        const cookies = await managed.context.cookies().catch(() => [])
        if (Array.isArray(cookies)) {
          await saveCookies(record, cookies as Parameters<typeof saveCookies>[1])
        }
      }
    } catch {
      /* best-effort */
    }
  }

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

async function createManagedSession(
  contextId: string,
  mode: BrowserMode,
  profile?: StealthProfile,
): Promise<ManagedSession> {
  evictOldestManagedSessionIfNeeded()
  startManagedSessionCleanup()
  const launchStartedAt = Date.now()
  const stealthProfile = normalizeStealthProfile(profile)
  const fingerprint = mode === 'stealth'
    ? buildStealthFingerprint(stealthProfile, contextId)
    : undefined
  const display = await allocateDisplayNumber()
  const vncPort = await allocateVncPort()
  const displayEnv = `:${display}`
  const browserWidth = fingerprint?.viewport.width || BROWSER_WIDTH
  const browserHeight = fingerprint?.viewport.height || BROWSER_HEIGHT

  const xvfbProcess = spawnProcess('Xvfb', [
    displayEnv,
    '-screen', '0', `${browserWidth}x${browserHeight}x24`,
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
        ...buildChromiumLaunchArgs(mode, stealthProfile),
        '--window-position=0,0',
        `--window-size=${browserWidth},${browserHeight}`,
      ],
    })

    context = await browser.newContext(await buildContextOptions(mode, {
      profile: stealthProfile,
      fingerprint,
    }))

    if (mode === 'stealth' && fingerprint) {
      await applyStealthInitScript(context, fingerprint, stealthProfile)
    }

    // Phase 4 of the web-trust plan: in `direct` mode, hydrate the context
    // with the user's persistent identity (cookies + locale + timezone) so a
    // returning visitor looks like the same person across sessions.
    if (mode === 'direct') {
      try {
        const [userId, sessionId] = contextId.split(':', 2) as [string, string]
        if (userId && sessionId) {
          const { getOrCreateIdentity, applyIdentityToContext } = await import('./uwaf-identity')
          const identityRecord = await getOrCreateIdentity(userId, sessionId, mode)
          await applyIdentityToContext(context, identityRecord)
        }
      } catch {
        /* best-effort */
      }
    }

    let activePage: Page | null = null
    const page = await context.newPage()
    activePage = page

    if (mode === 'stealth') {
      await page.setContent(buildStealthLandingHtml(stealthProfile), { waitUntil: 'domcontentloaded' }).catch(() => {})
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
      stealthProfile,
      fingerprint,
      display,
      vncPort,
      xvfbProcess,
      x11vncProcess,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    }

    browser.on('disconnected', () => {
      console.warn(`[uwaf-pool] Browser disconnected for ${contextId}`)
      logUwafSessionCrash({
        contextId,
        mode,
        reason: 'browser_disconnected',
      })
      void closeManagedSession(contextId)
    })

    uwafPoolState.sessions.set(contextId, managed)
    recordUwafLaunchTime(Date.now() - launchStartedAt)
    return managed
  } catch (error) {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await terminateChildProcess(x11vncProcess)
    await terminateChildProcess(xvfbProcess)
    throw error
  }
}

async function ensureManagedSession(contextId: string, mode: BrowserMode, profile?: StealthProfile): Promise<ManagedSession> {
  const existing = uwafPoolState.sessions.get(contextId)
  const resolvedProfile = normalizeStealthProfile(profile)
  if (existing) {
    const expired = Date.now() - existing.lastUsed > CONTEXT_TTL_MS
    const disconnected = !existing.browser.isConnected()
    const profileChanged = profile !== undefined && existing.stealthProfile !== resolvedProfile
    if (!expired && !disconnected && existing.mode === mode && !profileChanged) {
      existing.lastUsed = Date.now()
      return existing
    }
    await closeManagedSession(contextId)
  }

  const launchPromise = uwafPoolState.launchPromises.get(contextId)
  if (launchPromise) {
    const launched = await launchPromise
    if (launched.mode === mode && (profile === undefined || launched.stealthProfile === resolvedProfile)) {
      launched.lastUsed = Date.now()
      return launched
    }
    await closeManagedSession(contextId)
  }

  const nextLaunch = createManagedSession(contextId, mode, resolvedProfile)
    .finally(() => {
      uwafPoolState.launchPromises.delete(contextId)
    })

  uwafPoolState.launchPromises.set(contextId, nextLaunch)
  return nextLaunch
}

export async function getPage(contextId: string, mode: BrowserMode, profile?: StealthProfile): Promise<Page> {
  const managed = await ensureManagedSession(contextId, mode, profile)
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
      width: managed.fingerprint?.viewport.width || BROWSER_WIDTH,
      height: managed.fingerprint?.viewport.height || BROWSER_HEIGHT,
    },
  }
}

export async function closeContext(contextId: string): Promise<void> {
  await closeManagedSession(contextId)
}

async function withEphemeralBrowser<T>(
  contextOptions: Parameters<Browser['newContext']>[0],
  fn: (context: BrowserContext) => Promise<T>,
  options?: {
    stealthProfile?: StealthProfile
    fingerprint?: StealthFingerprint
  },
): Promise<T> {
  const resolvedContextOptions = contextOptions ?? {}
  const mode: BrowserMode = resolvedContextOptions.proxy?.server ? 'stealth' : 'direct'
  const stealthProfile = normalizeStealthProfile(options?.stealthProfile)
  const fingerprint = mode === 'stealth'
    ? (options?.fingerprint || buildStealthFingerprint(stealthProfile, `ephemeral:${Date.now()}`))
    : undefined
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: buildChromiumLaunchArgs(mode, stealthProfile),
  })

  const context = await browser.newContext(mode === 'stealth'
    ? await buildContextOptions(mode, { profile: stealthProfile, fingerprint })
    : resolvedContextOptions)
  if (mode === 'stealth' && fingerprint) {
    await applyStealthInitScript(context, fingerprint, stealthProfile)
  }

  try {
    return await fn(context)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

export async function checkTorProxyStatus(profile: StealthProfile = getDefaultStealthProfile()): Promise<{ reachable: boolean; error?: string }> {
  try {
    const proxyUrl = await getTorProxyUrl()
    return await withEphemeralBrowser({
      proxy: { server: proxyUrl },
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
    }, {
      stealthProfile: profile,
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

export async function getStealthInfo(profile: StealthProfile = getDefaultStealthProfile()): Promise<{ ip: string; country: string; isTor: boolean } | null> {
  try {
    const proxyUrl = await getTorProxyUrl()
    return await withEphemeralBrowser({
      proxy: { server: proxyUrl },
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
    }, {
      stealthProfile: profile,
    })
  } catch {
    return null
  }
}

export async function checkOnionResolution(rawUrl: string, profile: StealthProfile = getDefaultStealthProfile()): Promise<OnionResolutionResult> {
  const parsed = parseOnionUrl(rawUrl)
  const checkedAt = new Date().toISOString()
  if (!parsed) {
    return {
      ok: false,
      checkedAt,
      url: rawUrl,
      hostname: '',
      failureCode: 'invalid_onion_host',
      error: 'Invalid .onion URL.',
    }
  }

  if (!isValidOnionHostname(parsed.hostname)) {
    return {
      ok: false,
      checkedAt,
      url: parsed.href,
      hostname: parsed.hostname,
      failureCode: 'invalid_onion_host',
      error: `.onion hostname is not a valid v2/v3 onion address: ${parsed.hostname} (${describeOnionValidationIssue(parsed.hostname)}).`,
    }
  }

  const proxyUrl = await getTorProxyUrl()
  let lastError: { message: string; classified: Pick<OnionResolutionResult, 'failureCode' | 'error'> } = {
    message: '',
    classified: { failureCode: 'navigation_failed', error: 'Failed to reach .onion service.' },
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await delay(1500)
    }
    try {
      return await withEphemeralBrowser({
        proxy: { server: proxyUrl },
      }, async (context) => {
        const page = await context.newPage()
        try {
          const response = await page.goto(parsed.href, {
            timeout: 30_000,
            waitUntil: 'domcontentloaded',
          })
          return {
            ok: true,
            checkedAt,
            url: parsed.href,
            hostname: parsed.hostname,
            httpStatus: response?.status(),
            finalUrl: page.url(),
          }
        } finally {
          await page.close().catch(() => {})
        }
      }, {
        stealthProfile: profile,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError.message = message
      lastError.classified = classifyOnionResolutionError(message)
      const transient = /timeout|timed out|empty response|connection closed|connection refused/i.test(message)
      if (!transient) break
    }
  }

  return {
    ok: false,
    checkedAt,
    url: parsed.href,
    hostname: parsed.hostname,
    failureCode: lastError.classified.failureCode,
    error: `${lastError.classified.error || 'Address unreachable.'} Address verified unreachable after 2 attempts.`,
  }
}

export async function runStealthPreflight(options?: { force?: boolean; profile?: StealthProfile }): Promise<StealthPreflightResult> {
  const force = options?.force === true
  const profile = normalizeStealthProfile(options?.profile)
  const now = Date.now()

  const cached = stealthPreflightCache.get(profile)
  if (!force && cached && cached.expiresAt > now) {
    return cached.value
  }

  const pending = stealthPreflightPromises.get(profile)
  if (!force && pending) {
    return pending
  }

  const preflightPromise = (async () => {
    const checkedAt = new Date().toISOString()
    const fingerprint = buildStealthFingerprint(profile, `preflight:${checkedAt}`)
    const [torStatus, directIp, stealthInfo] = await Promise.all([
      checkTorProxyStatus(profile),
      getDirectIp().catch(() => 'unavailable'),
      getStealthInfo(profile).catch(() => null),
    ])

    let dnsLeakVerified = false
    let dnsLeakDetected = false
    let dnsResolverIps: string[] = []
    let webrtcExposed = true
    let udpLeakProtected = false
    let runtimeProtectionVerified = false
    let fingerprintRegressionPassed = false
    let fingerprintRegressionWarnings: string[] = []
    let fingerprintDetectors: StealthFingerprintDetectorResult[] = []
    const warnings: string[] = []

    try {
      const proxyUrl = await getTorProxyUrl()
      const runtimeChecks = await withEphemeralBrowser({
        proxy: { server: proxyUrl },
      }, async (context) => {
        const runtimeProtection = await verifyStealthRuntimeProtection(context)
        const dnsVerification = await runDnsLeakVerification(context, directIp)
        const fingerprintRegression = await runFingerprintRegressionChecks(context, profile)
        return {
          runtimeProtection,
          dnsVerification,
          fingerprintRegression,
        }
      }, {
        stealthProfile: profile,
        fingerprint,
      })

      webrtcExposed = runtimeChecks.runtimeProtection.webrtcExposed
      udpLeakProtected = runtimeChecks.runtimeProtection.udpLeakProtected
      runtimeProtectionVerified = runtimeChecks.runtimeProtection.runtimeProtectionVerified
      dnsLeakVerified = runtimeChecks.dnsVerification.dnsLeakVerified
      dnsLeakDetected = runtimeChecks.dnsVerification.dnsLeakDetected
      dnsResolverIps = runtimeChecks.dnsVerification.dnsResolverIps
      fingerprintRegressionPassed = runtimeChecks.fingerprintRegression.fingerprintRegressionPassed
      fingerprintRegressionWarnings = runtimeChecks.fingerprintRegression.fingerprintRegressionWarnings
      fingerprintDetectors = runtimeChecks.fingerprintRegression.fingerprintDetectors
    } catch (error) {
      warnings.push(`Stealth runtime verification failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    const torExitIp = stealthInfo?.ip || 'unavailable'
    const exitDiffersFromDirect = Boolean(
      torExitIp
      && directIp
      && torExitIp !== 'unknown'
      && torExitIp !== 'unavailable'
      && directIp !== 'unknown'
      && directIp !== 'unavailable'
      && torExitIp !== directIp
    )

    if (!runtimeProtectionVerified || !udpLeakProtected) {
      warnings.push(
        !runtimeProtectionVerified
          ? 'Stealth runtime verification could not prove WebRTC lockdown'
          : 'Stealth runtime verification indicates possible UDP/WebRTC exposure',
      )
    }
    warnings.push(...fingerprintRegressionWarnings)

    const ok = torStatus.reachable
      && stealthInfo?.isTor === true
      && exitDiffersFromDirect
      && dnsLeakVerified
      && runtimeProtectionVerified
    const error = !torStatus.reachable
      ? torStatus.error || 'Tor proxy unreachable'
      : stealthInfo?.isTor !== true
        ? 'Connected to the proxy but did not verify a Tor exit node'
        : !exitDiffersFromDirect
          ? 'Stealth preflight detected the same exit IP as direct mode'
          : !dnsLeakVerified
            ? dnsLeakDetected
              ? 'DNS leak verification indicates the direct IP was exposed in resolver results'
              : 'DNS leak verification did not produce trusted resolver evidence'
            : !runtimeProtectionVerified
              ? 'Stealth runtime verification could not prove WebRTC and browser-feature lockdown'
            : undefined

    const result: StealthPreflightResult = {
      ok,
      profile,
      fingerprintId: fingerprint.id,
      checkedAt,
      directIp,
      torExitIp,
      torExitCountry: stealthInfo?.country || 'unknown',
      torReachable: torStatus.reachable,
      torIsReady: stealthInfo?.isTor === true,
      exitDiffersFromDirect,
      dnsLeakVerified,
      dnsLeakDetected,
      dnsResolverIps,
      webrtcExposed,
      udpLeakProtected,
      runtimeProtectionVerified,
      fingerprintRegressionPassed,
      fingerprintRegressionWarnings,
      fingerprintDetectors,
      warnings,
      ...(error ? { error } : {}),
    }

    stealthPreflightCache.set(profile, {
      value: result,
      expiresAt: Date.now() + STEALTH_PREFLIGHT_TTL_MS,
    })

    return result
  })().finally(() => {
    stealthPreflightPromises.delete(profile)
  })

  stealthPreflightPromises.set(profile, preflightPromise)
  return preflightPromise
}

export async function shutdownPlaywright(): Promise<void> {
  const activeSessionIds = Array.from(uwafPoolState.sessions.keys())
  uwafPoolState.launchPromises.clear()

  for (const contextId of activeSessionIds) {
    await closeManagedSession(contextId)
  }
}
