import { estimateMessageTokens, estimateStringTokens, trimMessagesToFit } from './message-trim';

export type SessionAutoContinueMode = 'manual' | 'ask' | 'safe';
export type SessionContextHealth = 'fresh' | 'near-limit' | 'summarized' | 'trimmed';

export interface SessionMessageLike {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  hidden?: boolean;
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser' | 'tax_return' | 'pdf_document' | 'workbook_document' | 'word_document';
  thinking?: string;
  images?: unknown[];
  attachments?: unknown[];
  sources?: unknown[];
  createdAt?: string;
  meta?: unknown;
}

export interface SessionAnalytics {
  totalMessages: number;
  visibleMessages: number;
  hiddenMessages: number;
  userMessages: number;
  assistantMessages: number;
  systemMessages: number;
  toolCalls: number;
  toolCallsByType: Partial<Record<NonNullable<SessionMessageLike['toolRequest']>, number>>;
  assistantTokens: number;
  assistantDurationSeconds: number;
  averageTps: number;
  sourceCount: number;
  imageCount: number;
  attachmentCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  timeSpanSeconds: number;
}

export interface SessionIntelligenceSettings {
  summaryEnabled: boolean;
  summaryTargetTokens: number;
  preserveTurns: number;
  analyticsEnabled: boolean;
}

export interface ContextManagementResult<TMessage> {
  messages: TMessage[];
  trimmed: boolean;
  trimmedCount: number;
  contextSummary: string;
  contextHealth: SessionContextHealth;
  rawTokenEstimate: number;
  finalTokenEstimate: number;
  summaryUsed: boolean;
}

const MAX_SUMMARY_LINES = 18;
const MAX_SUMMARY_CHARS = 3200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeText(text: string, maxLength: number) {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeToolResult(message: SessionMessageLike) {
  const content = (message.content || '').trim();
  if (!message.hidden) return '';

  if (content.startsWith('Shell command result:')) {
    return `Tool result (shell): ${summarizeText(content.slice('Shell command result:'.length), 220)}`;
  }
  if (content.startsWith('Filesystem tool result:')) {
    return `Tool result (filesystem): ${summarizeText(content.slice('Filesystem tool result:'.length), 220)}`;
  }
  if (content.startsWith('Web research tool result:')) {
    return `Tool result (web): ${summarizeText(content.slice('Web research tool result:'.length), 220)}`;
  }
  if (content.startsWith('Code execution result:')) {
    return `Tool result (code): ${summarizeText(content.slice('Code execution result:'.length), 220)}`;
  }
  if (content.startsWith('Browser tool result:')) {
    return `Tool result (browser): ${summarizeText(content.slice('Browser tool result:'.length), 220)}`;
  }
  if (content.startsWith('UWAF browser tool result:')) {
    return `Tool result (unified browser): ${summarizeText(content.slice('UWAF browser tool result:'.length), 220)}`;
  }
  if (content.startsWith('Tax return PDF tool result:')) {
    return `Tool result (tax return): ${summarizeText(content.slice('Tax return PDF tool result:'.length), 220)}`;
  }
  if (content.startsWith('PDF document tool result:')) {
    return `Tool result (PDF document): ${summarizeText(content.slice('PDF document tool result:'.length), 220)}`;
  }
  if (content.startsWith('Excel workbook tool result:')) {
    return `Tool result (Excel workbook): ${summarizeText(content.slice('Excel workbook tool result:'.length), 220)}`;
  }
  if (content.startsWith('Word document tool result:')) {
    return `Tool result (Word document): ${summarizeText(content.slice('Word document tool result:'.length), 220)}`;
  }

  return content ? `Hidden result: ${summarizeText(content, 220)}` : '';
}

function summarizeMessage(message: SessionMessageLike) {
  if (message.hidden) {
    return summarizeToolResult(message);
  }

  if (message.role === 'user') {
    return `User request: ${summarizeText(message.content || '', 220)}`;
  }

  if (message.role === 'assistant') {
    const parts: string[] = [];
    if (message.toolRequest) {
      parts.push(`Assistant requested ${message.toolRequest}`);
    }
    if ((message.content || '').trim()) {
      parts.push(`Assistant response: ${summarizeText(message.content || '', 220)}`);
    }
    if (message.thinking?.trim()) {
      parts.push(`Reasoning summary: ${summarizeText(message.thinking, 160)}`);
    }
    return parts.join(' · ');
  }

  return `System note: ${summarizeText(message.content || '', 180)}`;
}

function uniqueLines(lines: string[]) {
  return lines.filter((line, index) => line && lines.indexOf(line) === index);
}

function serializeSummary(existingSummary: string, lines: string[]) {
  const mergedLines = [
    existingSummary.trim(),
    ...uniqueLines(lines).slice(0, MAX_SUMMARY_LINES),
  ]
    .filter(Boolean)
    .join('\n');

  return mergedLines.length <= MAX_SUMMARY_CHARS
    ? mergedLines
    : mergedLines.slice(0, MAX_SUMMARY_CHARS).trimEnd();
}

export function normalizeSessionAutoContinueMode(value: unknown): SessionAutoContinueMode {
  return value === 'safe' || value === 'ask' ? value : 'manual';
}

export function normalizeSessionSummaryTargetTokens(value: unknown, fallback = 6000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(64000, Math.max(2048, Math.round(parsed)));
}

export function normalizeSessionPreserveTurns(value: unknown, fallback = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(16, Math.max(2, Math.round(parsed)));
}

export function normalizeSessionAutoContinueMaxSteps(value: unknown, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

export function normalizeSessionAnalytics(raw: unknown): SessionAnalytics | null {
  if (!isRecord(raw)) return null;

  const toolCallsByTypeValue = isRecord(raw.toolCallsByType) ? raw.toolCallsByType : {};
  const toolCallsByType: SessionAnalytics['toolCallsByType'] = {};

  for (const key of ['shell', 'filesystem', 'web', 'code', 'browser', 'unified_browser', 'tax_return', 'pdf_document', 'workbook_document', 'word_document'] as const) {
    if (typeof toolCallsByTypeValue[key] === 'number') {
      toolCallsByType[key] = toolCallsByTypeValue[key] as number;
    }
  }

  return {
    totalMessages: typeof raw.totalMessages === 'number' ? raw.totalMessages : 0,
    visibleMessages: typeof raw.visibleMessages === 'number' ? raw.visibleMessages : 0,
    hiddenMessages: typeof raw.hiddenMessages === 'number' ? raw.hiddenMessages : 0,
    userMessages: typeof raw.userMessages === 'number' ? raw.userMessages : 0,
    assistantMessages: typeof raw.assistantMessages === 'number' ? raw.assistantMessages : 0,
    systemMessages: typeof raw.systemMessages === 'number' ? raw.systemMessages : 0,
    toolCalls: typeof raw.toolCalls === 'number' ? raw.toolCalls : 0,
    toolCallsByType,
    assistantTokens: typeof raw.assistantTokens === 'number' ? raw.assistantTokens : 0,
    assistantDurationSeconds: typeof raw.assistantDurationSeconds === 'number' ? raw.assistantDurationSeconds : 0,
    averageTps: typeof raw.averageTps === 'number' ? raw.averageTps : 0,
    sourceCount: typeof raw.sourceCount === 'number' ? raw.sourceCount : 0,
    imageCount: typeof raw.imageCount === 'number' ? raw.imageCount : 0,
    attachmentCount: typeof raw.attachmentCount === 'number' ? raw.attachmentCount : 0,
    firstMessageAt: typeof raw.firstMessageAt === 'string' ? raw.firstMessageAt : null,
    lastMessageAt: typeof raw.lastMessageAt === 'string' ? raw.lastMessageAt : null,
    timeSpanSeconds: typeof raw.timeSpanSeconds === 'number' ? raw.timeSpanSeconds : 0,
  };
}

function parseMessageMeta(value: unknown) {
  if (!isRecord(value)) return null;
  const tokens = typeof value.tokens === 'number' ? value.tokens : 0;
  const duration = typeof value.duration === 'number' ? value.duration : 0;
  const tps = typeof value.tps === 'number' ? value.tps : 0;
  return { tokens, duration, tps };
}

export function computeSessionAnalytics(
  messages: SessionMessageLike[],
  options?: {
    fallbackCreatedAt?: Date | null;
    fallbackUpdatedAt?: Date | null;
  },
): SessionAnalytics {
  const toolCallsByType: SessionAnalytics['toolCallsByType'] = {};
  let assistantTokens = 0;
  let assistantDurationSeconds = 0;
  let totalTpsWeight = 0;
  let totalTpsSamples = 0;
  let sourceCount = 0;
  let imageCount = 0;
  let attachmentCount = 0;

  for (const message of messages) {
    if (message.toolRequest) {
      toolCallsByType[message.toolRequest] = (toolCallsByType[message.toolRequest] || 0) + 1;
    }

    const meta = parseMessageMeta(message.meta);
    if (message.role === 'assistant' && meta) {
      assistantTokens += meta.tokens;
      assistantDurationSeconds += meta.duration;
      if (meta.tps > 0) {
        totalTpsWeight += meta.tps;
        totalTpsSamples += 1;
      }
    }

    sourceCount += Array.isArray(message.sources) ? message.sources.length : 0;
    imageCount += Array.isArray(message.images) ? message.images.length : 0;
    attachmentCount += Array.isArray(message.attachments) ? message.attachments.length : 0;
  }

  const createdTimes = messages
    .map(message => {
      if (typeof message.createdAt !== 'string') return null;
      const parsed = new Date(message.createdAt);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    })
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());

  const firstMessageAt = createdTimes[0] ?? options?.fallbackCreatedAt ?? null;
  const lastMessageAt = createdTimes[createdTimes.length - 1] ?? options?.fallbackUpdatedAt ?? null;
  const timeSpanSeconds = firstMessageAt && lastMessageAt
    ? Math.max(0, (lastMessageAt.getTime() - firstMessageAt.getTime()) / 1000)
    : 0;

  return {
    totalMessages: messages.length,
    visibleMessages: messages.filter(message => !message.hidden).length,
    hiddenMessages: messages.filter(message => message.hidden).length,
    userMessages: messages.filter(message => message.role === 'user').length,
    assistantMessages: messages.filter(message => message.role === 'assistant').length,
    systemMessages: messages.filter(message => message.role === 'system').length,
    toolCalls: Object.values(toolCallsByType).reduce((sum, count) => sum + count, 0),
    toolCallsByType,
    assistantTokens,
    assistantDurationSeconds: Math.round(assistantDurationSeconds * 100) / 100,
    averageTps: totalTpsSamples > 0 ? Math.round((totalTpsWeight / totalTpsSamples) * 10) / 10 : 0,
    sourceCount,
    imageCount,
    attachmentCount,
    firstMessageAt: firstMessageAt ? firstMessageAt.toISOString() : null,
    lastMessageAt: lastMessageAt ? lastMessageAt.toISOString() : null,
    timeSpanSeconds: Math.round(timeSpanSeconds),
  };
}

export function hasPendingContinuation(messages: SessionMessageLike[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.hidden) {
      if (message.role === 'user') {
        return false;
      }
      continue;
    }

    if (message.role === 'assistant' && message.toolRequest) {
      return true;
    }

    return false;
  }

  return false;
}

export function buildSessionContextSummary(
  messages: SessionMessageLike[],
  options: {
    existingSummary?: string;
    preserveTurns?: number;
  } = {},
) {
  const preserveTurns = normalizeSessionPreserveTurns(options.preserveTurns, 6);
  const nonSystem = messages.filter(message => message.role !== 'system');
  if (nonSystem.length <= preserveTurns * 2) {
    return '';
  }

  const firstUserIndex = nonSystem.findIndex(message => message.role === 'user');
  const summaryStart = firstUserIndex >= 0 ? firstUserIndex : 0;
  const recentStart = Math.max(summaryStart, nonSystem.length - preserveTurns * 2);
  const summaryCandidates = nonSystem.slice(summaryStart, recentStart);
  if (summaryCandidates.length === 0) {
    return options.existingSummary?.trim() || '';
  }
  const lines = uniqueLines(summaryCandidates.map(summarizeMessage).filter(Boolean));
  return serializeSummary(options.existingSummary || '', lines);
}

export function applyContextManagement<TMessage extends SessionMessageLike>(
  messages: TMessage[],
  options: {
    contextLength: number;
    systemOverhead: number;
    existingSummary?: string;
    summaryEnabled: boolean;
    summaryTargetTokens: number;
    preserveTurns: number;
  },
): ContextManagementResult<TMessage> {
  const rawTokenEstimate = estimateMessageTokens(messages);
  const nearLimitThreshold = Math.floor(options.contextLength * 0.75);
  const nonSystemCount = messages.filter(message => message.role !== 'system').length;
  const hasOlderTurnsOutsideRawWindow = nonSystemCount > normalizeSessionPreserveTurns(options.preserveTurns, 6) * 2;
  const shouldSummarize = options.summaryEnabled
    && (rawTokenEstimate >= options.summaryTargetTokens || hasOlderTurnsOutsideRawWindow);
  const contextSummary = shouldSummarize
    ? buildSessionContextSummary(messages, {
        existingSummary: options.existingSummary,
        preserveTurns: options.preserveTurns,
      })
    : options.existingSummary?.trim() || '';

  let messagesWithSummary = messages;

  if (contextSummary) {
    const summaryMessage = {
      role: 'system',
      content: [
        'Compressed session context summary from earlier turns.',
        'Treat this as authoritative session memory when the raw transcript below does not include those older turns.',
        '',
        contextSummary,
      ].join('\n'),
    } as TMessage;

    const firstSystemIndex = messages.findIndex(message => message.role === 'system');
    if (firstSystemIndex >= 0) {
      messagesWithSummary = [
        ...messages.slice(0, firstSystemIndex + 1),
        summaryMessage,
        ...messages.slice(firstSystemIndex + 1),
      ];
    } else {
      messagesWithSummary = [summaryMessage, ...messages];
    }
  }

  const trimResult = trimMessagesToFit(
    messagesWithSummary as Array<unknown>,
    options.contextLength,
    options.systemOverhead + (contextSummary ? estimateStringTokens(contextSummary) : 0),
    { preserveTurns: options.preserveTurns },
  );

  const finalMessages = trimResult.messages as TMessage[];
  const finalTokenEstimate = estimateMessageTokens(finalMessages);
  const contextHealth: SessionContextHealth = trimResult.trimmed
    ? contextSummary
      ? 'summarized'
      : 'trimmed'
    : finalTokenEstimate >= nearLimitThreshold
      ? 'near-limit'
      : contextSummary
        ? 'summarized'
        : 'fresh';

  return {
    messages: finalMessages,
    trimmed: trimResult.trimmed,
    trimmedCount: trimResult.trimmedCount,
    contextSummary,
    contextHealth,
    rawTokenEstimate,
    finalTokenEstimate,
    summaryUsed: Boolean(contextSummary),
  };
}
