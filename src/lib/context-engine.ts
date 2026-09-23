/**
 * Durable, model-aware context management primitives.
 *
 * This module deliberately has no database dependency. It is used by the
 * Postgres ledger as well as tests and gives every provider the same safe
 * budgeting rules: reserve room for an answer before deciding to compact.
 */

import { estimateMessageTokens } from './message-trim'

export type ContextPressure = 'fresh' | 'prepare' | 'compact' | 'rebuild' | 'emergency'

export interface ContextModelProfile {
  provider: string
  model: string
  contextWindow: number
  /** Tokens reserved for the next model response and reasoning. */
  responseReserve?: number
  /** Tool schemas, images, and provider framing not represented as messages. */
  toolReserve?: number
  /** Extra margin for imperfect provider token accounting. */
  safetyReserve?: number
}

export interface ContextBudget {
  contextWindow: number
  responseReserve: number
  toolReserve: number
  safetyReserve: number
  usableInputTokens: number
  promptTokens: number
  occupancy: number
  pressure: ContextPressure
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value!)))
}

/**
 * Creates a conservative budget. The percentages are intentionally based on
 * usable input, never the advertised context window: an agent needs room to
 * issue a tool call and receive its next answer after compaction decisions.
 */
export function buildContextBudget(
  profile: ContextModelProfile,
  promptTokens: number,
): ContextBudget {
  const contextWindow = boundedInt(profile.contextWindow, 4096, 1024, 2_000_000)
  const responseReserve = boundedInt(profile.responseReserve, Math.max(512, Math.ceil(contextWindow * 0.16)), 256, Math.floor(contextWindow * 0.45))
  const toolReserve = boundedInt(profile.toolReserve, Math.max(256, Math.ceil(contextWindow * 0.08)), 0, Math.floor(contextWindow * 0.3))
  const safetyReserve = boundedInt(profile.safetyReserve, Math.max(128, Math.ceil(contextWindow * 0.05)), 64, Math.floor(contextWindow * 0.2))
  const usableInputTokens = Math.max(256, contextWindow - responseReserve - toolReserve - safetyReserve)
  const normalizedPromptTokens = Math.max(0, Math.floor(promptTokens || 0))
  const occupancy = normalizedPromptTokens / usableInputTokens
  const pressure: ContextPressure = occupancy >= 0.9
    ? 'emergency'
    : occupancy >= 0.8
      ? 'rebuild'
      : occupancy >= 0.72
        ? 'compact'
        : occupancy >= 0.6
          ? 'prepare'
          : 'fresh'

  return { contextWindow, responseReserve, toolReserve, safetyReserve, usableInputTokens, promptTokens: normalizedPromptTokens, occupancy, pressure }
}

export interface ContextSourceMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  hidden?: boolean
  images?: unknown[]
}

/** An exact, stable source range for a compacted episode. */
export interface ContextEpisodeRange {
  startOrdinal: number
  endOrdinal: number
}

export function deriveEpisodeRange(messages: ContextSourceMessage[], preserveTurns: number): ContextEpisodeRange | null {
  const nonSystem = messages
    .map((message, ordinal) => ({ message, ordinal }))
    .filter(({ message }) => message.role !== 'system')
  const userOrdinals = nonSystem.filter(({ message }) => message.role === 'user' && !message.hidden).map(({ ordinal }) => ordinal)
  if (userOrdinals.length <= preserveTurns) return null
  const boundaryUserOrdinal = userOrdinals[userOrdinals.length - preserveTurns]
  const start = nonSystem[0]?.ordinal
  if (start === undefined || boundaryUserOrdinal <= start) return null
  return { startOrdinal: start, endOrdinal: boundaryUserOrdinal - 1 }
}

/**
 * Scores a source-linked memory against a new request. This remains useful on
 * deployments without pgvector; Postgres full-text/vector retrieval can replace
 * it without changing the prompt contract.
 */
export function scoreContextMemory(query: string, candidate: string): number {
  const terms = Array.from(new Set(query.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []))
  if (!terms.length) return 0
  const haystack = candidate.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) / terms.length
}

export function estimateContextMessages(messages: ContextSourceMessage[]): number {
  return estimateMessageTokens(messages)
}
