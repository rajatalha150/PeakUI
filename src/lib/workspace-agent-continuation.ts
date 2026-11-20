/** A short progress promise is not a finished WorkSpaces answer. */
export function isUnfinishedWorkspaceProgress(content: string): boolean {
  const text = content.trim().replace(/\s+/g, ' ')
  if (!text || text.length > 700) return false
  return /^(?:continuing|starting with|moving on to|proceeding to|working on|next up\b)/i.test(text)
    || /(?:[.!?]|—)\s*(?:continuing with|moving on to|proceeding to|next up\b|now (?:checking|researching|working on))[^.!?]*[.!?]?$/i.test(text)
    || /\b(?:i(?:'ll| will)|let me)\s+(?:continue|check|research|search|find|look up|start|work on|move on to)\b[^.!?]*[.!?]?$/i.test(text)
}

export function shouldContinueWorkspaceTurn(content: string, latestUserPrompt: string): boolean {
  if (isUnfinishedWorkspaceProgress(content)) return true
  const text = content.trim().replace(/\s+/g, ' ')
  if (!text) return false
  const persistenceRequested = /(?:\b(?:keep going|continue|next \d+ companies|until satisfied)\b|\bdon'?t stop\b|\bdo not end\b|\b(?:finish|complete)\b.{0,50}\bbatch\b)/i.test(latestUserPrompt)
  if (!persistenceRequested) return false
  if (/(?:want me to|would you like me to|shall i|let me know if you want|tell me which)/i.test(text.slice(-650))) return true
  if (text.length > 250) return false
  if (/^(?:done|complete(?:d)?|finished|blocked|unable to|cannot |could not )\b/i.test(text)) return false
  return true
}

export const WORKSPACE_PROGRESS_NUDGE = [
  'You just described work you intend to do next. That was a progress update, not completion of the user request.',
  'Do the next concrete step now with an available tool, then continue until the requested batch is complete or you have a specific blocker.',
  'Do not ask whether to perform work explicitly requested in the latest user message. If a separate approval is required for an action, pause for that approval. Do not end this round with another sentence promising to continue.',
].join(' ')
