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
  medianLaunchTimeMs: number | null
  medianPageOpenTimeMs: number | null
  searchSuccessRate: number | null
  recentLaunchTimes: UwafMetricSample[]
  recentPageOpenTimes: UwafMetricSample[]
  recentSearchOutcomes: UwafSearchOutcomeSample[]
  lastUpdatedAt: string
}

type UwafCounterMetric =
  | 'antiBotHits'
  | 'loginWalls'
  | 'searchFailures'
  | 'proxyFailures'
  | 'sessionCrashes'
  | 'actionFailures'
  | 'successfulActions'
  | 'totalActions'

interface UwafMetricSample {
  timestamp: string
  value: number
}

interface UwafSearchOutcomeSample {
  timestamp: string
  success: boolean
  mode: BrowserMode
}

const globalForUwafTelemetry = globalThis as typeof globalThis & {
  __peakuiUwafTelemetry?: {
    metrics: UwafMetricsSnapshot
    samples: {
      launchTimes: UwafMetricSample[]
      pageOpenTimes: UwafMetricSample[]
      searchOutcomes: UwafSearchOutcomeSample[]
    }
  }
}

const MAX_SAMPLE_COUNT = 200

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
    medianLaunchTimeMs: null,
    medianPageOpenTimeMs: null,
    searchSuccessRate: null,
    recentLaunchTimes: [],
    recentPageOpenTimes: [],
    recentSearchOutcomes: [],
    lastUpdatedAt: new Date(0).toISOString(),
  },
  samples: {
    launchTimes: [],
    pageOpenTimes: [],
    searchOutcomes: [],
  },
}

function touchMetrics() {
  uwafTelemetryState.metrics.lastUpdatedAt = new Date().toISOString()
}

function incrementMetric(metric: UwafCounterMetric, by = 1) {
  uwafTelemetryState.metrics[metric] += by
  touchMetrics()
}

function pushSample<T>(samples: T[], sample: T): void {
  samples.push(sample)
  if (samples.length > MAX_SAMPLE_COUNT) {
    samples.splice(0, samples.length - MAX_SAMPLE_COUNT)
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function recomputeAggregateMetrics(): void {
  uwafTelemetryState.metrics.medianLaunchTimeMs = median(uwafTelemetryState.samples.launchTimes.map(sample => sample.value))
  uwafTelemetryState.metrics.medianPageOpenTimeMs = median(uwafTelemetryState.samples.pageOpenTimes.map(sample => sample.value))
  const searchOutcomes = uwafTelemetryState.samples.searchOutcomes
  uwafTelemetryState.metrics.searchSuccessRate = searchOutcomes.length > 0
    ? Number((searchOutcomes.filter(sample => sample.success).length / searchOutcomes.length).toFixed(3))
    : null
  uwafTelemetryState.metrics.recentLaunchTimes = uwafTelemetryState.samples.launchTimes.slice(-50)
  uwafTelemetryState.metrics.recentPageOpenTimes = uwafTelemetryState.samples.pageOpenTimes.slice(-50)
  uwafTelemetryState.metrics.recentSearchOutcomes = uwafTelemetryState.samples.searchOutcomes.slice(-50)
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
  if (input.action === 'search') {
    pushSample(uwafTelemetryState.samples.searchOutcomes, {
      timestamp: new Date().toISOString(),
      success: input.result?.success === true && !input.error,
      mode: input.mode,
    })
    recomputeAggregateMetrics()
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

export function recordUwafLaunchTime(durationMs: number) {
  pushSample(uwafTelemetryState.samples.launchTimes, {
    timestamp: new Date().toISOString(),
    value: Math.max(0, Math.round(durationMs)),
  })
  recomputeAggregateMetrics()
}

export function recordUwafPageOpenTime(durationMs: number) {
  pushSample(uwafTelemetryState.samples.pageOpenTimes, {
    timestamp: new Date().toISOString(),
    value: Math.max(0, Math.round(durationMs)),
  })
  recomputeAggregateMetrics()
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
  recomputeAggregateMetrics()
  return {
    ...uwafTelemetryState.metrics,
    recentLaunchTimes: [...uwafTelemetryState.metrics.recentLaunchTimes],
    recentPageOpenTimes: [...uwafTelemetryState.metrics.recentPageOpenTimes],
    recentSearchOutcomes: [...uwafTelemetryState.metrics.recentSearchOutcomes],
  }
}
