/**
 * WorkSpaces context-usage normalization and formatting.
 *
 * Mirrors `coder-context.ts` for the Coder surface: the Coder side reads an
 * exact, model-native token count from the daemon, while the WorkSpaces surface
 * drives the model directly and budgets every turn against the model's resolved
 * context window. The API endpoint (`/api/workspace-tool/session/[id]/context`)
 * resolves that window per-model (via `getModelCapacityProfile`), then runs it
 * through `buildContextBudget`; this module turns the resulting pressure/
 * occupancy into the same compact "tokens / window (tier)" shape the Coder
 * meter renders, so the two surfaces look and behave alike.
 */

export type WorkspaceContextTier = 'fresh' | 'prepare' | 'compact' | 'rebuild' | 'emergency'

export interface WorkspaceContextUsage {
  model: string
  totalTokens: number
  contextWindow: number
  /** Input budget after reserving room for the answer, tools, and safety margin. */
  usableInputTokens: number
  /** Remaining usable input capacity at the time of the snapshot. */
  freeTokens: number
  /** 0–1 fraction of usable input consumed. */
  occupancy: number
  tier: WorkspaceContextTier
  /** Token counts are estimates unless the upstream provider reports exact usage. */
  isEstimated: boolean
  /** The context manager's resulting health after summary/trim decisions. */
  contextHealth?: 'fresh' | 'near-limit' | 'summarized' | 'trimmed'
  /** Where the snapshot came from, useful when reconnecting to a durable run. */
  source?: 'session' | 'model-response' | 'run-event'
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/**
 * Accepts both the direct `context_usage` event payload and `{ usage }` API
 * responses. Keeping this parser shared means a refresh, a live run, and a
 * daemon reconnect cannot silently disagree about the meter shape.
 */
export function normalizeWorkspaceContextUsage(value: unknown): WorkspaceContextUsage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const source = record.usage && typeof record.usage === 'object'
    ? record.usage as Record<string, unknown>
    : record
  const model = typeof source.model === 'string' ? source.model : ''
  const totalTokens = finite(source.totalTokens)
  const contextWindow = finite(source.contextWindow)
  if (totalTokens === null || contextWindow === null || contextWindow <= 0) return null
  const usableInputTokens = finite(source.usableInputTokens) ?? contextWindow
  const freeTokens = finite(source.freeTokens) ?? Math.max(0, usableInputTokens - totalTokens)
  const rawOccupancy = typeof source.occupancy === 'number' && Number.isFinite(source.occupancy)
    ? source.occupancy
    : usableInputTokens > 0 ? totalTokens / usableInputTokens : 1
  const tier = source.tier === 'fresh' || source.tier === 'prepare' || source.tier === 'compact' || source.tier === 'rebuild' || source.tier === 'emergency'
    ? source.tier
    : null
  if (!tier) return null
  const contextHealth = source.contextHealth === 'fresh' || source.contextHealth === 'near-limit' || source.contextHealth === 'summarized' || source.contextHealth === 'trimmed'
    ? source.contextHealth
    : undefined
  const normalizedSource = source.source === 'session' || source.source === 'model-response' || source.source === 'run-event'
    ? source.source
    : undefined
  return {
    model,
    totalTokens,
    contextWindow,
    usableInputTokens,
    freeTokens,
    occupancy: Math.max(0, Math.min(1, rawOccupancy)),
    tier,
    isEstimated: source.isEstimated !== false,
    ...(contextHealth ? { contextHealth } : {}),
    ...(normalizedSource ? { source: normalizedSource } : {}),
  }
}

/**
 * Format a usage snapshot the way the Coder meter does: `12.3k / 16.0k (compact)`.
 */
export function formatWorkspaceContextUsage(usage: WorkspaceContextUsage | null): string {
  if (!usage) return 'Context unavailable'
  const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
  return `${compact(usage.totalTokens)} / ${compact(usage.contextWindow)} tokens (${usage.tier})`
}

/** Color tone for the meter pill, matching the Coder tier colors. */
export function workspaceContextTierTone(tier: WorkspaceContextTier): 'danger' | 'warning' | 'success' {
  if (tier === 'emergency' || tier === 'rebuild') return 'danger'
  if (tier === 'compact' || tier === 'prepare') return 'warning'
  return 'success'
}
