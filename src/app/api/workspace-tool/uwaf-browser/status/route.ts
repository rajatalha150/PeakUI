import net from 'node:net'
import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getDirectIp, getStealthInfo, getTorProxyUrl, runStealthPreflight } from '@/lib/uwaf-pool'
import { getUwafMetricsSnapshot } from '@/lib/uwaf-telemetry'
import { getDefaultStealthProfile } from '@/lib/uwaf-fingerprint'
import { getCuratedStealthEntryPoints, getPreferredSearchProviderLabel, getSearchProviderSnapshot } from '@/lib/uwaf-search-providers'

const QUICK_STATUS_TTL_MS = 5 * 60 * 1000
const DEEP_STATUS_TTL_MS = 10 * 60 * 1000
const QUICK_STATUS_STARTUP_BUDGET_MS = 1200

type StatusLevel = 'cached' | 'quick' | 'preflight'

interface UwafStatusPayload {
  directIp: string
  torReachable?: boolean
  torIsReady?: boolean
  torError?: string
  torExitIp?: string
  torExitCountry?: string
  stealthPreflightOk?: boolean
  stealthPreflightCheckedAt?: string
  stealthPreflightError?: string
  stealthExitDiffersFromDirect?: boolean
  stealthDnsLeakVerified?: boolean
  stealthDnsLeakDetected?: boolean
  stealthDnsResolverIps?: string[]
  stealthWebrtcExposed?: boolean
  stealthUdpLeakProtected?: boolean
  stealthRuntimeProtectionVerified?: boolean
  stealthFingerprintId?: string
  stealthProfile: ReturnType<typeof getDefaultStealthProfile>
  stealthFingerprintRegressionPassed?: boolean
  stealthFingerprintRegressionWarnings: string[]
  stealthFingerprintDetectors: unknown[]
  stealthWarnings: string[]
  stealthSearchEngine: string
  stealthSearchProviders: ReturnType<typeof getSearchProviderSnapshot>
  stealthCuratedEntryPoints: ReturnType<typeof getCuratedStealthEntryPoints>
  onionReady?: boolean
  statusLevel: StatusLevel
  statusCached: boolean
  statusCheckedAt?: string
  statusRefreshInProgress?: boolean
  metrics: ReturnType<typeof getUwafMetricsSnapshot>
}

const globalForUwafStatus = globalThis as typeof globalThis & {
  __peakuiUwafStatusCache?: {
    quick?: { value: UwafStatusPayload; expiresAt: number }
    deep?: { value: UwafStatusPayload; expiresAt: number }
    quickPromise?: Promise<UwafStatusPayload>
    deepPromise?: Promise<UwafStatusPayload>
  }
}

const statusCache = globalForUwafStatus.__peakuiUwafStatusCache ??= {}

function commonStatusFields(profile: ReturnType<typeof getDefaultStealthProfile>) {
  return {
    stealthSearchEngine: getPreferredSearchProviderLabel('stealth', '', profile),
    stealthSearchProviders: getSearchProviderSnapshot('stealth'),
    stealthCuratedEntryPoints: getCuratedStealthEntryPoints(),
    metrics: getUwafMetricsSnapshot(),
  }
}

function withFreshCommonFields(payload: UwafStatusPayload): UwafStatusPayload {
  return {
    ...payload,
    ...commonStatusFields(payload.stealthProfile),
  }
}

function pendingQuickStatus(profile: ReturnType<typeof getDefaultStealthProfile>): UwafStatusPayload {
  return {
    directIp: 'checking',
    stealthProfile: profile,
    stealthFingerprintRegressionWarnings: [],
    stealthFingerprintDetectors: [],
    stealthWarnings: [],
    ...commonStatusFields(profile),
    statusLevel: 'quick',
    statusCached: false,
    statusRefreshInProgress: true,
  }
}

function getCachedStatus(profile: ReturnType<typeof getDefaultStealthProfile>): UwafStatusPayload {
  const cached = statusCache.deep?.value || statusCache.quick?.value
  if (cached) {
    return withFreshCommonFields({ ...cached, statusLevel: 'cached', statusCached: true })
  }

  return {
    directIp: 'unknown',
    stealthProfile: profile,
    stealthFingerprintRegressionWarnings: [],
    stealthFingerprintDetectors: [],
    stealthWarnings: [],
    ...commonStatusFields(profile),
    statusLevel: 'cached',
    statusCached: false,
    statusCheckedAt: new Date().toISOString(),
  }
}

const QUICK_STATUS_TIMEOUT_MS = 4500

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ])
}

async function probeTorSocksProxy(timeoutMs = 1200): Promise<boolean> {
  try {
    const proxyUrl = await getTorProxyUrl()
    const parsed = new URL(proxyUrl)
    const hostname = parsed.hostname
    const port = Number(parsed.port)
    if (!hostname || !Number.isFinite(port)) return false
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: hostname, port }, () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.setTimeout(timeoutMs, () => {
        socket.destroy()
        resolve(false)
      })
    })
  } catch {
    return false
  }
}

async function buildQuickStatus(profile: ReturnType<typeof getDefaultStealthProfile>): Promise<UwafStatusPayload> {
  const [torProxyReachable, directIp, stealthInfo] = await Promise.all([
    probeTorSocksProxy(1200),
    withTimeout(getDirectIp().catch(() => 'unavailable'), QUICK_STATUS_TIMEOUT_MS, 'unavailable'),
    withTimeout(getStealthInfo(profile).catch(() => null), QUICK_STATUS_TIMEOUT_MS, null),
  ])
  const checkedAt = new Date().toISOString()
  const torVerified = stealthInfo?.isTor === true
  const torReachable = torVerified || torProxyReachable
  const torIsReady = torVerified ? true : (torProxyReachable && !stealthInfo ? undefined : false)
  const torError = torVerified
    ? undefined
    : torProxyReachable
      ? (stealthInfo ? 'Tor proxy responded, but exit check was not a Tor node.' : undefined)
      : 'Tor proxy is unreachable.'

  return {
    directIp,
    torReachable,
    torIsReady,
    torError,
    torExitIp: stealthInfo?.ip,
    torExitCountry: stealthInfo?.country,
    stealthProfile: profile,
    stealthFingerprintRegressionWarnings: [],
    stealthFingerprintDetectors: [],
    stealthWarnings: [],
    ...commonStatusFields(profile),
    onionReady: undefined,
    statusLevel: 'quick',
    statusCached: false,
    statusCheckedAt: checkedAt,
  }
}

async function getQuickStatus(profile: ReturnType<typeof getDefaultStealthProfile>, force = false): Promise<UwafStatusPayload> {
  const now = Date.now()
  const cached = statusCache.quick
  if (!force && cached && cached.expiresAt > now) {
    return withFreshCommonFields({ ...cached.value, statusCached: true })
  }

  if (!statusCache.quickPromise || force) {
    statusCache.quickPromise = buildQuickStatus(profile)
      .then((value) => {
        statusCache.quick = {
          value,
          expiresAt: Date.now() + QUICK_STATUS_TTL_MS,
        }
        return value
      })
      .finally(() => {
        statusCache.quickPromise = undefined
      })
  }

  const fallback = cached
    ? withFreshCommonFields({ ...cached.value, statusCached: true, statusRefreshInProgress: true })
    : pendingQuickStatus(profile)

  return Promise.race([
    statusCache.quickPromise,
    new Promise<UwafStatusPayload>((resolve) => setTimeout(() => resolve(fallback), QUICK_STATUS_STARTUP_BUDGET_MS)),
  ])
}

async function buildDeepStatus(profile: ReturnType<typeof getDefaultStealthProfile>, force: boolean): Promise<UwafStatusPayload> {
  const stealthPreflight = await runStealthPreflight({ profile, force, includeDiagnostics: true }).catch(() => null)
  const directIp = stealthPreflight?.directIp || statusCache.quick?.value.directIp || 'unavailable'

  return {
    directIp,
    torReachable: stealthPreflight?.torReachable,
    torIsReady: stealthPreflight?.torIsReady,
    torError: stealthPreflight?.error,
    torExitIp: stealthPreflight?.torExitIp,
    torExitCountry: stealthPreflight?.torExitCountry,
    stealthPreflightOk: stealthPreflight?.ok === true,
    stealthPreflightCheckedAt: stealthPreflight?.checkedAt,
    stealthPreflightError: stealthPreflight?.error,
    stealthExitDiffersFromDirect: stealthPreflight?.exitDiffersFromDirect,
    stealthDnsLeakVerified: stealthPreflight?.dnsLeakVerified,
    stealthDnsLeakDetected: stealthPreflight?.dnsLeakDetected,
    stealthDnsResolverIps: stealthPreflight?.dnsResolverIps,
    stealthWebrtcExposed: stealthPreflight?.webrtcExposed,
    stealthUdpLeakProtected: stealthPreflight?.udpLeakProtected,
    stealthRuntimeProtectionVerified: stealthPreflight?.runtimeProtectionVerified,
    stealthFingerprintId: stealthPreflight?.fingerprintId,
    stealthProfile: stealthPreflight?.profile || profile,
    stealthFingerprintRegressionPassed: stealthPreflight?.fingerprintRegressionPassed,
    stealthFingerprintRegressionWarnings: stealthPreflight?.fingerprintRegressionWarnings || [],
    stealthFingerprintDetectors: stealthPreflight?.fingerprintDetectors || [],
    stealthWarnings: stealthPreflight?.warnings || [],
    ...commonStatusFields(stealthPreflight?.profile || profile),
    onionReady: stealthPreflight?.ok === true,
    statusLevel: 'preflight',
    statusCached: false,
    statusCheckedAt: stealthPreflight?.checkedAt || new Date().toISOString(),
  }
}

async function getDeepStatus(profile: ReturnType<typeof getDefaultStealthProfile>, force: boolean): Promise<UwafStatusPayload> {
  const now = Date.now()
  const cached = statusCache.deep
  if (!force && cached && cached.expiresAt > now) {
    return withFreshCommonFields({ ...cached.value, statusCached: true })
  }

  if (!statusCache.deepPromise || force) {
    statusCache.deepPromise = buildDeepStatus(profile, force)
      .then((value) => {
        statusCache.deep = {
          value,
          expiresAt: Date.now() + DEEP_STATUS_TTL_MS,
        }
        statusCache.quick = {
          value: {
            ...value,
            statusLevel: 'quick',
          },
          expiresAt: Date.now() + QUICK_STATUS_TTL_MS,
        }
        return value
      })
      .finally(() => {
        statusCache.deepPromise = undefined
      })
  }

  return statusCache.deepPromise
}

export async function GET(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'workspace-tool.uwaf'], {
    forbiddenMessage: 'WorkSpaces stealth browser access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces stealth browser permission in Settings -> User Management before accessing UWAF status for this user.',
  })
  if ('response' in access) return access.response

  const profile = getDefaultStealthProfile()
  const rawLevel = request.nextUrl.searchParams.get('level')
  const level: StatusLevel = rawLevel === 'preflight'
    ? 'preflight'
    : rawLevel === 'cached'
      ? 'cached'
      : 'quick'
  const force = request.nextUrl.searchParams.get('force') === '1'
  const status = level === 'preflight'
    ? await getDeepStatus(profile, force)
    : level === 'cached'
      ? getCachedStatus(profile)
      : await getQuickStatus(profile, force)

  return NextResponse.json(status)
}
