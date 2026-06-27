import { estimateMessageTokens, estimateStringTokens, trimMessagesToFit } from './message-trim';

export type SessionAutoContinueMode = 'manual' | 'ask' | 'safe';
export type SessionContextHealth = 'fresh' | 'near-limit' | 'summarized' | 'trimmed';

export interface SessionMessageLike {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  hidden?: boolean;
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser' | 'tax_return' | 'pdf_document' | 'workbook_document' | 'word_document' | 'csv_document' | 'email_document' | 'markdown_document' | 'slides_document' | 'archive_document' | 'calendar_document' | 'mermaid_document' | 'fetch_summarize';
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

const MAX_SUMMARY_CHARS = 3200;
const MAX_MEMORY_ITEMS_PER_SECTION = 6;

type WorkingMemorySectionKey =
  | 'objective'
  | 'currentStatus'
  | 'importantDecisions'
  | 'userPreferences'
  | 'filesFoldersArtifacts'
  | 'openQuestions'
  | 'nextStep';

const WORKING_MEMORY_SECTIONS: Array<{
  key: WorkingMemorySectionKey;
  heading: string;
}> = [
  { key: 'objective', heading: 'Objective' },
  { key: 'currentStatus', heading: 'Current status' },
  { key: 'importantDecisions', heading: 'Important decisions' },
  { key: 'userPreferences', heading: 'User preferences' },
  { key: 'filesFoldersArtifacts', heading: 'Files, folders, artifacts' },
  { key: 'openQuestions', heading: 'Open questions' },
  { key: 'nextStep', heading: 'Next step' },
];

type WorkingMemory = Record<WorkingMemorySectionKey, string[]>;

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

function normalizeShortPrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLowSignalWorkspacePrompt(text: string): boolean {
  const normalized = normalizeShortPrompt(text);
  if (!normalized) return true;

  const greetings = new Set([
    'hi',
    'hello',
    'hey',
    'yo',
    'sup',
    'test',
    'testing',
    'thanks',
    'thank you',
    'ok',
    'okay',
    'cool',
  ]);
  if (greetings.has(normalized)) return true;

  const words = normalized.split(' ').filter(Boolean);
  return words.length <= 3 && words.every(word => greetings.has(word));
}

export function isContinuationWorkspacePrompt(text: string): boolean {
  const normalized = normalizeShortPrompt(text);
  if (!normalized) return false;

  return /^(?:go ahead|proceed|continue|keep going|go on|do it|please do|yes|yeah|yep|retry|try again|open it|check it|that one|sounds good|lets do it|let s do it)$/.test(normalized);
}

function createEmptyWorkingMemory(): WorkingMemory {
  return {
    objective: [],
    currentStatus: [],
    importantDecisions: [],
    userPreferences: [],
    filesFoldersArtifacts: [],
    openQuestions: [],
    nextStep: [],
  };
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

function normalizeMemoryLine(value: string): string {
  return summarizeText(
    value
      .replace(/^[-*•]\s+/, '')
      .replace(/^(?:User request|Assistant response|Tool result \([^)]+\)|Hidden result|System note):\s*/i, '')
      .trim(),
    280,
  );
}

function pushMemory(memory: WorkingMemory, key: WorkingMemorySectionKey, value: string, limit = MAX_MEMORY_ITEMS_PER_SECTION) {
  const clean = normalizeMemoryLine(value);
  if (!clean) return;
  if (key === 'objective' && isLowSignalWorkspacePrompt(clean)) return;

  memory[key] = uniqueLines([clean, ...memory[key]]).slice(0, limit);
}

function parseExistingWorkingMemory(existingSummary: string): WorkingMemory {
  const memory = createEmptyWorkingMemory();
  const existing = existingSummary.trim();
  if (!existing) return memory;

  const sectionByHeading = new Map(WORKING_MEMORY_SECTIONS.map(section => [section.heading.toLowerCase(), section.key]));
  let currentKey: WorkingMemorySectionKey | null = null;
  let parsedStructured = false;

  for (const rawLine of existing.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      currentKey = sectionByHeading.get(headingMatch[1].trim().toLowerCase()) ?? null;
      parsedStructured = Boolean(currentKey);
      continue;
    }

    if (currentKey) {
      pushMemory(memory, currentKey, line);
    }
  }

  if (parsedStructured) return memory;

  for (const line of existing.split('\n').map(entry => entry.trim()).filter(Boolean)) {
    if (/^User request:/i.test(line)) {
      pushMemory(memory, memory.objective.length === 0 ? 'objective' : 'currentStatus', line);
    } else if (/^Assistant response:/i.test(line)) {
      pushMemory(memory, 'currentStatus', line);
    } else if (/^Tool result|^Hidden result/i.test(line)) {
      pushMemory(memory, 'filesFoldersArtifacts', line);
    } else if (/\?$/.test(line)) {
      pushMemory(memory, 'openQuestions', line);
    } else {
      pushMemory(memory, 'currentStatus', line);
    }
  }

  return memory;
}

function extractTaskStateFromSystemMessage(content: string, memory: WorkingMemory) {
  if (!/WorkSpaces task state:|Open Claw task state:/i.test(content)) return;

  const paragraphs = content.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    const [label, ...rest] = paragraph.split('\n');
    const value = rest.join('\n').trim();
    if (!value) continue;

    if (/^Objective:/i.test(label)) pushMemory(memory, 'objective', value, 1);
    if (/^Current status:/i.test(label)) pushMemory(memory, 'currentStatus', value, 3);
    if (/^Next step:/i.test(label)) pushMemory(memory, 'nextStep', value, 2);
    if (/^Done criteria:/i.test(label)) pushMemory(memory, 'importantDecisions', `Done when: ${value}`, 3);
    if (/^Pinned checklist:/i.test(label)) pushMemory(memory, 'nextStep', value, 3);
  }
}

function classifyUserMessage(content: string, memory: WorkingMemory, options: { isFirstUser: boolean }) {
  const text = summarizeText(content, 500);
  if (!text) return;

  if (options.isFirstUser && memory.objective.length === 0 && !isLowSignalWorkspacePrompt(text) && !isContinuationWorkspacePrompt(text)) {
    pushMemory(memory, 'objective', text, 1);
  }

  if (/\b(?:remember|always|never|prefer|preference|do not|don't|dont|make sure|use this|leave .* alone|keep .* there)\b/i.test(text)) {
    pushMemory(memory, 'userPreferences', text);
  }

  if (/\b(?:we decided|decision|go with|choose|chosen|selected|use .* instead|we will|we're going to|approved|confirmed)\b/i.test(text)) {
    pushMemory(memory, 'importantDecisions', text);
  }

  if (/\b(?:file|folder|pdf|docx|xlsx|workbook|artifact|canvas|knowledge base|rag|workspace|directory|path)\b/i.test(text)) {
    pushMemory(memory, 'filesFoldersArtifacts', text);
  }

  if (/\b(?:issue|problem|bug|error|failing|unable|broken|stuck|regression|missing)\b/i.test(text)) {
    pushMemory(memory, 'currentStatus', text);
  }

  if (/\?$/.test(text) || /\b(?:question|unclear|figure out|investigate|audit)\b/i.test(text)) {
    pushMemory(memory, 'openQuestions', text);
  }

  if (/\b(?:next|after this|one more thing|once done|then|follow up|lastly|before redeploy|redeploy|commit|push)\b/i.test(text)) {
    pushMemory(memory, 'nextStep', text);
  }
}

function classifyAssistantMessage(message: SessionMessageLike, memory: WorkingMemory) {
  const content = summarizeText(message.content || '', 500);
  if (!content) return;

  if (message.toolRequest) {
    pushMemory(memory, 'filesFoldersArtifacts', `Assistant used ${message.toolRequest}: ${content}`);
  }

  if (message.role === 'assistant' || /\b(?:done|implemented|fixed|updated|verified|tests? passed|build passed|committed|pushed|redeployed|diagnosed)\b/i.test(content)) {
    pushMemory(memory, 'currentStatus', content);
  }

  if (/\b(?:next step|follow up|remaining|todo|pending|should)\b/i.test(content)) {
    pushMemory(memory, 'nextStep', content);
  }
}

function serializeWorkingMemory(memory: WorkingMemory): string {
  const parts: string[] = [];

  for (const section of WORKING_MEMORY_SECTIONS) {
    const lines = uniqueLines(memory[section.key].map(normalizeMemoryLine).filter(Boolean)).slice(0, MAX_MEMORY_ITEMS_PER_SECTION);
    if (lines.length === 0) continue;
    parts.push(`## ${section.heading}`, ...lines.map(line => `- ${line}`), '');
  }

  const serialized = parts.join('\n').trim();
  return serialized.length <= MAX_SUMMARY_CHARS
    ? serialized
    : serialized.slice(0, MAX_SUMMARY_CHARS).trimEnd();
}

function sanitizeWorkingMemorySummary(existingSummary: string): string {
  const memory = parseExistingWorkingMemory(existingSummary);
  return serializeWorkingMemory(memory);
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

const MEMORY_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'current',
  'done', 'from', 'have', 'into', 'just', 'make', 'more', 'need', 'needs', 'should', 'that',
  'their', 'there', 'these', 'thing', 'this', 'those', 'through', 'user', 'using', 'what',
  'when', 'where', 'with', 'work', 'would', 'your',
]);

function extractMemoryKeywords(text: string): Set<string> {
  const normalized = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  return new Set(normalized.filter(word => word.length >= 4 && !MEMORY_STOP_WORDS.has(word)));
}

export function isCrossSessionMemoryRelevant(memoryContext: string, relevanceText: string): boolean {
  const memoryKeywords = extractMemoryKeywords(memoryContext);
  const queryKeywords = extractMemoryKeywords(relevanceText);
  if (memoryKeywords.size === 0 || queryKeywords.size === 0) return false;

  for (const keyword of queryKeywords) {
    if (memoryKeywords.has(keyword)) return true;
  }

  return false;
}

export function filterRelevantCrossSessionMemory(memoryContext: string, relevanceText: string): string {
  const clean = memoryContext.trim();
  if (!clean) return '';
  return isCrossSessionMemoryRelevant(clean, relevanceText) ? clean : '';
}

export function buildSessionContextSummary(
  messages: SessionMessageLike[],
  options: {
    existingSummary?: string;
    preserveTurns?: number;
  } = {},
) {
  const existingSummary = sanitizeWorkingMemorySummary(options.existingSummary || '');
  const preserveTurns = normalizeSessionPreserveTurns(options.preserveTurns, 6);
  const nonSystem = messages.filter(message => message.role !== 'system');
  if (nonSystem.length <= preserveTurns * 2) {
    return existingSummary;
  }

  const firstUserIndex = nonSystem.findIndex(message => message.role === 'user');
  const summaryStart = firstUserIndex >= 0 ? firstUserIndex : 0;
  const recentStart = Math.max(summaryStart, nonSystem.length - preserveTurns * 2);
  const summaryCandidates = nonSystem.slice(summaryStart, recentStart);
  if (summaryCandidates.length === 0) {
    return existingSummary;
  }

  const memory = parseExistingWorkingMemory(existingSummary);
  const firstUserIndexInCandidates = summaryCandidates.findIndex(message => message.role === 'user');

  for (const message of messages) {
    if (message.role === 'system') {
      extractTaskStateFromSystemMessage(message.content || '', memory);
    }
  }

  for (const [index, message] of summaryCandidates.entries()) {
    if (message.hidden) {
      const toolSummary = summarizeToolResult(message);
      if (toolSummary) pushMemory(memory, 'filesFoldersArtifacts', toolSummary);
      continue;
    }

    if (message.role === 'user') {
      classifyUserMessage(message.content || '', memory, {
        isFirstUser: index === firstUserIndexInCandidates && memory.objective.length === 0,
      });
      continue;
    }

    if (message.role === 'assistant') {
      classifyAssistantMessage(message, memory);
    }
  }

  return serializeWorkingMemory(memory);
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
  const existingSummary = sanitizeWorkingMemorySummary(options.existingSummary || '');
  const rawTokenEstimate = estimateMessageTokens(messages);
  const nearLimitThreshold = Math.floor(options.contextLength * 0.75);
  const nonSystemCount = messages.filter(message => message.role !== 'system').length;
  const hasOlderTurnsOutsideRawWindow = nonSystemCount > normalizeSessionPreserveTurns(options.preserveTurns, 6) * 2;
  const shouldSummarize = options.summaryEnabled
    && (rawTokenEstimate >= options.summaryTargetTokens || hasOlderTurnsOutsideRawWindow);
  const contextSummary = shouldSummarize
    ? buildSessionContextSummary(messages, {
        existingSummary,
        preserveTurns: options.preserveTurns,
      })
    : existingSummary;

  let messagesWithSummary = messages;

  if (contextSummary) {
    const summaryMessage = {
      role: 'system',
      content: [
        'Working memory for this thread.',
        'Use it to preserve continuity about goals, decisions, preferences, files, open questions, and next steps.',
        'If this working memory conflicts with newer user messages or the recent raw transcript, prefer the newer messages.',
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
