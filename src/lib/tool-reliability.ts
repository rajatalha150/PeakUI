/**
 * Tool reliability telemetry (Phase 4).
 *
 * Tracks per-model, per-tool success/failure counts so the user can see which
 * local model actually calls tools reliably — and switch off the broken ones.
 * This is the "would have caught every loop this session" feature: a tool that
 * fails 5× in a row is visible here instead of surfacing as a cryptic
 * transcript.
 *
 * Storage is an in-memory ring buffer (bounded) keyed by `model|tool`. It is
 * intentionally NOT persisted to the DB — reliability is a live, session-scoped
 * signal, and a cold start simply begins a fresh window. The API exposes a
 * snapshot and a reset.
 */

export interface ToolOutcomeRecord {
  model: string
  tool: string
  success: number
  failure: number
  lastError: string
  lastAt: string
}

const MAX_KEYS = 500
const MAX_LAST_ERROR_CHARS = 300

const store = new Map<string, ToolOutcomeRecord>()

function key(model: string, tool: string): string {
  return `${model}\u0000${tool}`
}

function safeModel(value: string): string {
  return value.trim().slice(0, 120) || 'unknown'
}

function safeTool(value: string): string {
  return value.trim().slice(0, 80) || 'unknown'
}

/**
 * Record a tool outcome. Pure side-effect on the in-memory store; never throws.
 */
export function recordToolOutcome(
  model: string,
  tool: string,
  success: boolean,
  errorMessage?: string,
): void {
  const k = key(safeModel(model), safeTool(tool))
  const existing = store.get(k)
  const now = new Date().toISOString()

  if (existing) {
    if (success) existing.success += 1
    else {
      existing.failure += 1
      if (errorMessage) existing.lastError = errorMessage.slice(0, MAX_LAST_ERROR_CHARS)
    }
    existing.lastAt = now
    return
  }

  // Bound the store: evict the oldest key when over capacity.
  if (store.size >= MAX_KEYS) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }

  store.set(k, {
    model: safeModel(model),
    tool: safeTool(tool),
    success: success ? 1 : 0,
    failure: success ? 0 : 1,
    lastError: success ? '' : (errorMessage || '').slice(0, MAX_LAST_ERROR_CHARS),
    lastAt: now,
  })
}

/**
 * Snapshot of all recorded outcomes, sorted by failure rate descending (the
 * most-broken model/tool pairs first).
 */
export function getToolReliability(): ToolOutcomeRecord[] {
  return [...store.values()].sort((a, b) => {
    const aRate = a.failure / Math.max(1, a.success + a.failure)
    const bRate = b.failure / Math.max(1, b.success + b.failure)
    if (bRate !== aRate) return bRate - aRate
    return (b.failure + b.success) - (a.failure + a.success)
  })
}

export function resetToolReliability(): void {
  store.clear()
}

export const __test__ = {
  key,
  MAX_KEYS,
}
