import type { BrowserMode } from './uwaf-pool'
import type { UwafAction, UwafBrowserResult } from './uwaf-browser'

interface UwafActionTelemetryInput {
  userId: string
  sessionId: string
  action: UwafAction
  mode: BrowserMode
  durationMs: number
  requestTarget?: string
  result?: Pick<
    UwafBrowserResult,
    | 'success'
    | 'failureCode'
    | 'failureDetail'
    | 'antiBotDetected'
    | 'loginDetected'
    | 'currentUrl'
    | 'finalUrl'
    | 'requestedUrl'
    | 'requestedQuery'
    | 'resultCount'
    | 'searchEngine'
    | 'redirected'
    | 'httpStatus'
    | 'source'
  >
  error?: string
  httpStatus?: number
}

interface UwafTorDiagnosticInput {
  userId: string
  sessionId: string
  mode: BrowserMode
  outcome: 'pass' | 'fail'
  durationMs: number
  directIp?: string
  torExitIp?: string
  torExitCountry?: string
  exitDiffersFromDirect?: boolean
  error?: string
  checkedAt?: string
}

interface UwafCrashTelemetryInput {
  contextId: string
  mode?: BrowserMode
  reason: string
}

interface UwafMetricsSnapshot {
  antiBotHits: number
  loginWalls: number
  searchFailures: number
  proxyFailures: number
  sessionCrashes: number
  actionFailures: number
  successfulActions: number
  totalActions: number
  lastUpdatedAt: string
}

const globalForUwafTelemetry = globalThis as typeof globalThis & {
  __peakuiUwafTelemetry?: {
    metrics: UwafMetricsSnapshot
  }
}

const uwafTelemetryState = globalForUwafTelemetry.__peakuiUwafTelemetry ??= {
  metrics: {
    antiBotHits: 0,
    loginWalls: 0,
    searchFailures: 0,
    proxyFailures: 0,
    sessionCrashes: 0,
    actionFailures: 0,
    successfulActions: 0,
    totalActions: 0,
    lastUpdatedAt: new Date(0).toISOString(),
  },
}

function touchMetrics() {
  uwafTelemetryState.metrics.lastUpdatedAt = new Date().toISOString()
}

function incrementMetric(metric: keyof Omit<UwafMetricsSnapshot, 'lastUpdatedAt'>, by = 1) {
  uwafTelemetryState.metrics[metric] += by
  touchMetrics()
}

function redactUserId(userId: string): string {
  if (userId.length <= 8) return userId
  return `${userId.slice(0, 4)}...${userId.slice(-4)}`
}

function logStructured(prefix: string, payload: Record<string, unknown>) {
  console.info(prefix, JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  }))
}

export function logUwafActionTelemetry(input: UwafActionTelemetryInput) {
  incrementMetric('totalActions')
  if (input.result?.success === true && !input.error) {
    incrementMetric('successfulActions')
  } else {
    incrementMetric('actionFailures')
  }

  const failureCode = input.result?.failureCode
  if (input.result?.antiBotDetected || failureCode === 'anti_bot_detected') {
    incrementMetric('antiBotHits')
  }
  if (input.result?.loginDetected || failureCode === 'login_required') {
    incrementMetric('loginWalls')
  }
  if (input.action === 'search' && failureCode && failureCode !== 'anti_bot_detected' && failureCode !== 'login_required') {
    incrementMetric('searchFailures')
  }
  if (input.mode === 'stealth' && (input.error?.toLowerCase().includes('tor') || input.error?.toLowerCase().includes('proxy') || failureCode === 'tor_unavailable')) {
    incrementMetric('proxyFailures')
  }

  logStructured('[uwaf-action]', {
    userId: redactUserId(input.userId),
    sessionId: input.sessionId,
    action: input.action,
    mode: input.mode,
    requestTarget: input.requestTarget,
    durationMs: input.durationMs,
    httpStatus: input.httpStatus,
    error: input.error,
    result: input.result ? {
      success: input.result.success,
      failureCode: input.result.failureCode,
      failureDetail: input.result.failureDetail,
      antiBotDetected: input.result.antiBotDetected,
      loginDetected: input.result.loginDetected,
      currentUrl: input.result.currentUrl,
      finalUrl: input.result.finalUrl,
      requestedUrl: input.result.requestedUrl,
      requestedQuery: input.result.requestedQuery,
      resultCount: input.result.resultCount,
      searchEngine: input.result.searchEngine,
      redirected: input.result.redirected,
      httpStatus: input.result.httpStatus,
      source: input.result.source,
    } : undefined,
  })
}

export function logUwafTorDiagnostic(input: UwafTorDiagnosticInput) {
  if (input.outcome === 'fail') {
    incrementMetric('proxyFailures')
  }

  logStructured('[uwaf-tor]', {
    userId: redactUserId(input.userId),
    sessionId: input.sessionId,
    mode: input.mode,
    outcome: input.outcome,
    durationMs: input.durationMs,
    checkedAt: input.checkedAt,
    directIp: input.directIp,
    torExitIp: input.torExitIp,
    torExitCountry: input.torExitCountry,
    exitDiffersFromDirect: input.exitDiffersFromDirect,
    error: input.error,
  })
}

export function logUwafSessionCrash(input: UwafCrashTelemetryInput) {
  incrementMetric('sessionCrashes')
  logStructured('[uwaf-crash]', {
    contextId: input.contextId,
    mode: input.mode,
    reason: input.reason,
  })
}

export function getUwafMetricsSnapshot(): UwafMetricsSnapshot {
  return { ...uwafTelemetryState.metrics }
}
