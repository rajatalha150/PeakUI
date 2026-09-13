import { TOOL_RESULT_HEADER_RE } from './tool-registry';

export interface ConversationMessage {
  role: string;
  content?: string;
  hidden?: boolean;
  images?: unknown[];
}

/** Legacy transcripts may lack `hidden`; recognized result envelopes aren't user turns. */
export function isUserTurn(message: ConversationMessage): boolean {
  return message.role === 'user' && !message.hidden
    && !TOOL_RESULT_HEADER_RE.test(message.content || '');
}

/** Index of the first of the last N real user turns, including all their tool activity. */
export function recentTurnStart(messages: ConversationMessage[], preserveTurns: number): number {
  const count = Number.isFinite(preserveTurns) ? Math.max(1, Math.floor(preserveTurns)) : 4;
  let turns = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isUserTurn(messages[index]) && ++turns === count) return index;
  }
  return 0;
}
