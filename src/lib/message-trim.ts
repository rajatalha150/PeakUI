/**
 * Message trimming for context window management.
 *
 * When a conversation grows beyond the model's context window, older messages
 * are dropped to fit. The strategy preserves system messages, the first user
 * message (for topic context), and recent turns while trimming from the middle.
 */

import { recentTurnStart, isUserTurn, type ConversationMessage } from './conversation-turns';

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

export interface TrimResult<T = unknown> {
  messages: T[];
  trimmed: boolean;
  trimmedCount: number;
  fitsBudget: boolean;
  tokenEstimate: number;
  inputBudget: number;
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
export function trimMessagesToFit<T extends ConversationMessage>(
  messages: T[],
  contextLength: number,
  systemOverhead: number,
  options?: { preserveTurns?: number },
): TrimResult<T> {
  const context = Number.isFinite(contextLength) ? Math.max(0, Math.floor(contextLength)) : 0;
  const inputBudget = Math.floor(context * 0.8);
  const systems = messages.filter(message => message.role === 'system');
  const conversation = messages.filter(message => message.role !== 'system');
  const systemTokens = estimateMessageTokens(systems);
  // Additional external overhead (e.g. native tool schemas) is counted once.
  const overhead = Math.max(systemTokens, Number.isFinite(systemOverhead) ? systemOverhead : 0);
  const budget = inputBudget - overhead;
  const result = (kept: T[]): TrimResult<T> => {
    const tokenEstimate = estimateMessageTokens(kept) + overhead;
    return {
      messages: [...systems, ...kept],
      trimmed: kept.length !== conversation.length,
      trimmedCount: conversation.length - kept.length,
      fitsBudget: tokenEstimate <= inputBudget,
      tokenEstimate,
      inputBudget,
    };
  };
  if (estimateMessageTokens(conversation) <= budget) return result(conversation);

  const firstUser = conversation.findIndex(isUserTurn);
  const recentStart = recentTurnStart(conversation, options?.preserveTurns ?? 4);
  // Drop old turns as whole groups, preserving the original objective.
  let kept = conversation.filter((_, index) => index === firstUser || index >= recentStart);
  if (estimateMessageTokens(kept) <= budget) return result(kept);

  // Recent-turn preservation is a preference, not permission to overflow.
  // Progressively retire older complete turns, retaining the active turn and
  // initial user objective. Never truncate instructions or orphan tool results.
  const activeStart = recentTurnStart(conversation, 1);
  for (let index = recentStart + 1; index <= activeStart; index++) {
    if (!isUserTurn(conversation[index])) continue;
    kept = conversation.filter((_, position) => position === firstUser || position >= index);
    if (estimateMessageTokens(kept) <= budget) return result(kept);
  }
  // The caller must reject an impossible budget explicitly. This protects the
  // latest request/images and system instructions from silent data loss.
  return result(kept);
}

export function requireContextBudget<T extends ConversationMessage>(
  messages: T[], contextLength: number, extraTokens = 0, preserveTurns = 4,
): T[] {
  const result = trimMessagesToFit(messages, contextLength,
    estimateMessageTokens(messages.filter(message => message.role === 'system')) + extraTokens,
    { preserveTurns });
  if (!result.fitsBudget) {
    throw new Error(`Context budget exceeded: required about ${result.tokenEstimate} input tokens, budget ${result.inputBudget}. Increase context length, shorten the request, or reduce attached context.`);
  }
  return result.messages;
}
