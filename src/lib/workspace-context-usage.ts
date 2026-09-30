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
  /** 0–1 fraction of usable input consumed. */
  occupancy: number
  tier: WorkspaceContextTier
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
