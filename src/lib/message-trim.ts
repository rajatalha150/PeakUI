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
 * Collapse every system-role message into a single leading system message.
 *
 * Some model chat templates (notably custom GGUF templates such as
 * "The-Defiant-Fable" Qwen models) raise "System message must be at the
 * beginning" when a `system` role message appears anywhere except the first
 * position. PeakUI injects additional system-role context mid-conversation
 * (working-memory summaries, RAG tree/KB context, automation nudges, uncensored
 * reinforcement), which trips those templates. This normalizes the sequence to
 * [system, ...nonSystem] while preserving all system content (joined into the
 * single leading system message) and the original order of user/assistant
 * messages. Safe for models that tolerate multiple system messages — the wire
 * format just gets a single leading system message either way.
 */
export function collapseSystemMessages<T extends { role: string; content?: string }>(messages: T[]): T[] {
  const systemParts: string[] = [];
  const rest: T[] = [];
  let systemCount = 0;
  for (const message of messages) {
    if (message.role === 'system') {
      systemCount += 1;
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      if (content) systemParts.push(content);
    } else {
      rest.push(message);
    }
  }
  if (systemCount === 0) return messages;
  if (systemParts.length === 0) return rest;
  return [{ role: 'system', content: systemParts.join('\n\n') } as T, ...rest];
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
  const roleOf = (message: unknown): string => {
    const record = message as { role?: unknown };
    return typeof record.role === 'string' ? record.role : '';
  };
  const systemMessages = messages.filter(message => roleOf(message) === 'system');
  const nonSystemMessages = messages.filter(message => roleOf(message) !== 'system');

  // Reserve 20% of context for the model's response
  const responseBudget = Math.floor(contextLength * 0.2);
  const messageBudget = contextLength - responseBudget - systemOverhead;

  if (messageBudget <= 0) {
    // System prompt alone exceeds budget — send only system + latest user message
    const lastUserMsg = [...messages].reverse().find(message => roleOf(message) === 'user');
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
  const firstUserIdx = nonSystemMessages.findIndex(message => roleOf(message) === 'user');
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