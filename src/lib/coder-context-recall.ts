/**
 * Close the coder surface's write-only recall gap.
 *
 * PeakUI's durable context ledger already records coder sessions
 * (`persistContextLedger` runs for surface `'coder'`) and captures a
 * provider-native recap before auto-compaction, but nothing ever read that
 * back into a reattached coder session — the WorkSpaces surface recalls
 * matching episodes on every turn while the coder surface did not.
 *
 * This module builds the bounded, source-linked "prior context" note that the
 * coder prompt path injects ahead of the user's live message, mirroring the
 * boundary-marker convention already used for WorkSpaces memory injection.
 * The note is clearly marked as background so the model does not treat it as
 * the current task.
 */

import { recallContextEpisodes } from './context-ledger'

export const CODER_RECALL_NOTE_PREFIX =
  '[Prior context from earlier in this project — background, not the current task]'

/** A content block as the daemon's prompt array expects. */
export interface CoderPromptBlock {
  type?: unknown
  text?: unknown
  [key: string]: unknown
}

export interface CoderRecallInjection {
  /** The enriched prompt array with the recall note prepended. */
  prompt: CoderPromptBlock[]
  /** Episode ids that contributed to the note (for observability/testing). */
  episodeIds: string[]
}

/**
 * Extract the latest user text from a daemon prompt array to use as the recall
 * query. Image-only (vision) prompts yield no text and are skipped.
 */
export function coderRecallQuery(prompt: unknown): string {
  if (!Array.isArray(prompt) || prompt.length === 0) return ''
  return prompt
    .filter((block): block is CoderPromptBlock => typeof block === 'object' && block !== null && !Array.isArray(block))
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .filter((text): text is string => typeof text === 'string')
    .join(' ')
    .slice(0, 2_000)
}

/**
 * Build the enriched prompt. Returns `null` when there is no user text to query
 * against or no matching episodes to inject, so the prompt passes through
 * unchanged in the common (empty-ledger / first-turn) case. Recall failures are
 * swallowed here — a recall miss must never block a prompt.
 */
export async function enrichCoderPromptWithRecall(
  sessionId: string,
  prompt: unknown,
  recall: typeof recallContextEpisodes = recallContextEpisodes,
): Promise<CoderRecallInjection | null> {
  if (!Array.isArray(prompt) || prompt.length === 0) return null
  const query = coderRecallQuery(prompt).trim()
  if (!query) return null
  try {
    const result = await recall(sessionId, query)
    if (!result.content.trim()) return null
    const note = `${CODER_RECALL_NOTE_PREFIX}\n${result.content}`
    return {
      prompt: [{ type: 'text', text: note }, ...prompt],
      episodeIds: result.episodeIds,
    }
  } catch (error) {
    console.error('Coder context recall failed:', error)
    return null
  }
}
