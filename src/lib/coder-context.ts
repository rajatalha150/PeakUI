/** Authoritative Qwen daemon context-usage normalization and policy. */

export type CoderContextTier = 'fresh' | 'warn' | 'auto' | 'hard' | 'unknown'

export interface CoderContextUsage {
  model: string
  totalTokens: number
  contextWindow: number
  freeTokens: number | null
  tier: CoderContextTier
  thresholds: { warn: number | null; auto: number | null; hard: number | null; effectiveWindow: number | null }
  isEstimated: boolean
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

export function normalizeCoderContextUsage(value: unknown): CoderContextUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = (value as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return null
  const record = usage as Record<string, unknown>
  const breakdown = record.breakdown && typeof record.breakdown === 'object'
    ? record.breakdown as Record<string, unknown>
    : {}
  const thresholds = breakdown.thresholds && typeof breakdown.thresholds === 'object'
    ? breakdown.thresholds as Record<string, unknown>
    : {}
  const totalTokens = finite(record.totalTokens)
  const contextWindow = finite(record.contextWindowSize)
  if (totalTokens === null || contextWindow === null || contextWindow === 0) return null
  const tierValue = breakdown.currentTier
  const tier: CoderContextTier = tierValue === 'warn' || tierValue === 'auto' || tierValue === 'hard' || tierValue === 'fresh'
    ? tierValue
    : 'unknown'
  return {
    model: typeof record.modelName === 'string' ? record.modelName : '',
    totalTokens,
    contextWindow,
    freeTokens: finite(breakdown.freeSpace),
    tier,
    thresholds: {
      warn: finite(thresholds.warn),
      auto: finite(thresholds.auto),
      hard: finite(thresholds.hard),
      effectiveWindow: finite(thresholds.effectiveWindow),
    },
    isEstimated: record.isEstimated === true,
  }
}

/** A handoff is useful at warn or above, before native auto-compaction starts. */
export function shouldCaptureCoderHandoff(usage: CoderContextUsage | null): boolean {
  return usage?.tier === 'warn' || usage?.tier === 'auto' || usage?.tier === 'hard'
}

export function formatCoderContextUsage(usage: CoderContextUsage | null): string {
  if (!usage) return 'Context unavailable'
  const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
  return `${compact(usage.totalTokens)} / ${compact(usage.contextWindow)} tokens (${usage.tier})`
}
