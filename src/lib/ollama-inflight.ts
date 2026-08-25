import { ollamaModelKey } from './embedding-models'

/**
 * Process-wide registry of in-flight model usages.
 *
 * PeakUI has two GPU consumers — the chat model and the embedding model — that
 * share one GPU. The exclusive-model unload and the GPU arbiter must never
 * evict a model that is actively streaming a response or computing an
 * embedding, or the in-flight request fails mid-flight. This module tracks
 * those usages with a refcount so concurrent requests on the same model are
 * handled correctly (the model stays "in use" until the last one ends).
 *
 * This is the PeakUI analogue of Unsloth's keep-warm middleware: a cheap,
 * invisible bookkeeping layer that makes model eviction safe.
 */

export type ModelUseKind = 'chat' | 'embedding'

interface InFlightEntry {
  model: string
  kind: ModelUseKind
  count: number
}

const inFlight = new Map<string, InFlightEntry>()

/**
 * Mark a model as in use and return a release function. The release function
 * is idempotent and safe to call more than once.
 */
export function beginModelUse(model: string, kind: ModelUseKind): () => void {
  const key = ollamaModelKey(model)
  const existing = inFlight.get(key)
  if (existing) {
    existing.count += 1
  } else {
    inFlight.set(key, { model, kind, count: 1 })
  }

  let ended = false
  return () => {
    if (ended) return
    ended = true
    const entry = inFlight.get(key)
    if (!entry) return
    entry.count -= 1
    if (entry.count <= 0) inFlight.delete(key)
  }
}

/** Whether a model is currently streaming or embedding. */
export function isModelInUse(model: string): boolean {
  return inFlight.has(ollamaModelKey(model))
}

/** Snapshot of the models currently in use. */
export function listInFlightModels(): Array<{ model: string; kind: ModelUseKind }> {
  return [...inFlight.values()].map(({ model, kind }) => ({ model, kind }))
}

/** Number of distinct models currently in use. */
export function inFlightCount(): number {
  return inFlight.size
}

/** Test-only reset. */
export function __resetInFlightForTest(): void {
  inFlight.clear()
}
