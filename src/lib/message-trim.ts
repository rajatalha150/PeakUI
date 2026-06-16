/**
 * Message trimming for context window management.
 *
 * When a conversation grows beyond the model's context window, older messages
 * are dropped to fit. The strategy preserves system messages, the first user
 * message (for topic context), and recent turns while trimming from the middle.
 */

const CHARS_PER_TOKEN = 4;
const ROLE_OVERHEAD_TOKENS = 4;
const IMAGE_TOKEN_OVERHEAD = 256;

export function estimateStringTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: Array<{ content?: string; images?: unknown[] }>): number {
  return messages.reduce((total, msg) => {
    const contentTokens = msg.content ? estimateStringTokens(msg.content) : 0;
    const imageTokens = (msg.images?.length ?? 0) * IMAGE_TOKEN_OVERHEAD;
    return total + ROLE_OVERHEAD_TOKENS + contentTokens + imageTokens;
  }, 0);
}

export interface TrimResult {
  messages: Array<unknown>;
  trimmed: boolean;
  trimmedCount: number;
}

/**
 * Trim messages to fit within a context budget.
 *
 * @param messages - The full message array (including system messages)
 * @param contextLength - The model's context window size in tokens
 * @param systemOverhead - Estimated tokens consumed by system prompt + RAG + internet prompt
 * @param options - preserveTurns: how many recent turns to keep (default 4)
 * @returns Trimmed message array and metadata
 */
export function trimMessagesToFit(
  messages: Array<unknown>,
  contextLength: number,
  systemOverhead: number,
  options?: { preserveTurns?: number },
): TrimResult {
  const preserveTurns = options?.preserveTurns ?? 4;
  const systemMessages = messages.filter((m: any) => m.role === 'system');
  const nonSystemMessages = messages.filter((m: any) => m.role !== 'system');

  // Reserve 20% of context for the model's response
  const responseBudget = Math.floor(contextLength * 0.2);
  const messageBudget = contextLength - responseBudget - systemOverhead;

  if (messageBudget <= 0) {
    // System prompt alone exceeds budget — send only system + latest user message
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
    return {
      messages: [...systemMessages, ...(lastUserMsg ? [lastUserMsg] : [])],
      trimmed: true,
      trimmedCount: messages.length - systemMessages.length - (lastUserMsg ? 1 : 0),
    };
  }

  // The system/tool prompt is already represented by systemOverhead, so only
  // compare conversation turns against messageBudget. Counting system messages
  // here as well trims useful chat memory too early.
  const currentTokens = estimateMessageTokens(nonSystemMessages as Array<{ content?: string; images?: unknown[] }>);
  if (currentTokens <= messageBudget) {
    return { messages, trimmed: false, trimmedCount: 0 };
  }

  // Preserve: first user message + last N turns
  const preservedIndices = new Set<number>();
  const firstUserIdx = nonSystemMessages.findIndex((m: any) => m.role === 'user');
  if (firstUserIdx >= 0) preservedIndices.add(firstUserIdx);
  const recentStart = Math.max(0, nonSystemMessages.length - preserveTurns * 2);
  for (let i = recentStart; i < nonSystemMessages.length; i++) {
    preservedIndices.add(i);
  }

  // Iteratively remove the oldest removable message until we fit
  const result = [...nonSystemMessages];
  let removedCount = 0;
  const minMessages = 2; // Always keep at least 1 user + 1 assistant

  while (
    estimateMessageTokens(result as Array<{ content?: string; images?: unknown[] }>) > messageBudget
    && result.length > minMessages
  ) {
    // Find the oldest message that isn't preserved
    const removableIdx = result.findIndex((_, i) => !preservedIndices.has(i + removedCount));
    if (removableIdx === -1) break;
    result.splice(removableIdx, 1);
    removedCount++;
  }

  return {
    messages: [...systemMessages, ...result],
    trimmed: true,
    trimmedCount: removedCount,
  };
}