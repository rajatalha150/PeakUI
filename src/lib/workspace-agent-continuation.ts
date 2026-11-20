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
  if (text.length > 250 || !text) return false
  if (!/(?:\b(?:keep going|continue|next \d+ companies|until satisfied)\b|\bdon'?t stop\b)/i.test(latestUserPrompt)) return false
  if (/^(?:done|complete(?:d)?|finished|blocked|unable to|cannot |could not )\b/i.test(text)) return false
  return true
}

export const WORKSPACE_PROGRESS_NUDGE = [
  'You just described work you intend to do next. That was a progress update, not completion of the user request.',
  'Do the next concrete step now with an available tool, then continue until the requested batch is complete or you have a specific blocker.',
  'Do not end this round with another sentence promising to continue.',
].join(' ')
