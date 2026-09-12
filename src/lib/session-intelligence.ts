import { estimateMessageTokens, estimateStringTokens, trimMessagesToFit } from './message-trim';

export type SessionAutoContinueMode = 'manual' | 'ask' | 'safe';
export type SessionContextHealth = 'fresh' | 'near-limit' | 'summarized' | 'trimmed';

export interface SessionMessageLike {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  hidden?: boolean;
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser' | 'tax_return' | 'pdf_document' | 'workbook_document' | 'word_document' | 'csv_document' | 'email_document' | 'markdown_document' | 'slides_document' | 'archive_document' | 'calendar_document' | 'mermaid_document' | 'fetch_summarize' | 'image_generation' | 'notes_search' | 'notes_save' | 'http_request';
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

const TOOL_RESULT_PREFIXES: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ['Shell command result:', 'shell'],
  ['Filesystem tool result:', 'filesystem'],
  ['Web research tool result:', 'web'],
  ['Code execution result:', 'code'],
  ['Browser tool result:', 'browser'],
  ['UWAF browser tool result:', 'unified browser'],
  ['Tax return PDF tool result:', 'tax return'],
  ['Tax return tool result:', 'tax return'],
  ['PDF document tool result:', 'PDF document'],
  ['Excel workbook tool result:', 'Excel workbook'],
  ['Word document tool result:', 'Word document'],
  ['CSV export tool result:', 'CSV export'],
  ['Email writer tool result:', 'Email writer'],
  ['Markdown document tool result:', 'Markdown document'],
  ['Slide deck tool result:', 'Slide deck'],
  ['Archive tool result:', 'Archive'],
  ['Calendar tool result:', 'Calendar'],
  ['Mermaid diagram tool result:', 'Mermaid diagram'],
  ['URL fetch and summarize tool result:', 'URL fetch and summarize'],
  ['Image generation tool result:', 'Image generation'],
  ['Notes search tool result:', 'Notes search'],
  ['Notes save tool result:', 'Notes save'],
  ['HTTP request tool result:', 'HTTP request'],
];

function summarizeToolResult(message: SessionMessageLike) {
  const content = (message.content || '').trim();
  if (!message.hidden) return '';

  for (const [prefix, label] of TOOL_RESULT_PREFIXES) {
    if (content.startsWith(prefix)) {
      return `Tool result (${label}): ${summarizeText(content.slice(prefix.length), 220)}`;
    }
  }

  return content ? `Hidden result: ${summarizeText(content, 220)}` : '';
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    if (line && !seen.has(line)) {
      seen.add(line);
      unique.push(line);
    }
  }
  return unique;
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

  const legacyRules: ReadonlyArray<{
    test: (line: string) => boolean;
    section: (memory: WorkingMemory) => WorkingMemorySectionKey;
  }> = [
    {
      test: line => /^User request:/i.test(line),
      section: memory => (memory.objective.length === 0 ? 'objective' : 'currentStatus'),
    },
    { test: line => /^Assistant response:/i.test(line), section: () => 'currentStatus' },
    { test: line => /^Tool result|^Hidden result/i.test(line), section: () => 'filesFoldersArtifacts' },
    { test: line => /\?$/.test(line), section: () => 'openQuestions' },
    { test: () => true, section: () => 'currentStatus' },
  ];

  for (const line of existing.split('\n').map(entry => entry.trim()).filter(Boolean)) {
    for (const rule of legacyRules) {
      if (rule.test(line)) {
        pushMemory(memory, rule.section(memory), line);
        break;
      }
    }
  }

  return memory;
}

const TASK_STATE_RULES: ReadonlyArray<{
  label: RegExp;
  section: WorkingMemorySectionKey;
  limit: number;
  transform?: (value: string) => string;
}> = [
  { label: /^Objective:/i, section: 'objective', limit: 1 },
  { label: /^Current status:/i, section: 'currentStatus', limit: 3 },
  { label: /^Next step:/i, section: 'nextStep', limit: 2 },
  { label: /^Done criteria:/i, section: 'importantDecisions', limit: 3, transform: value => `Done when: ${value}` },
  { label: /^Pinned checklist:/i, section: 'nextStep', limit: 3 },
];

function extractTaskStateFromSystemMessage(content: string, memory: WorkingMemory) {
  if (!/WorkSpaces task state:|Workspace Tool task state:/i.test(content)) return;

  const paragraphs = content.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    const [label, ...rest] = paragraph.split('\n');
    const value = rest.join('\n').trim();
    if (!value) continue;

    for (const rule of TASK_STATE_RULES) {
      if (rule.label.test(label)) {
        pushMemory(memory, rule.section, rule.transform ? rule.transform(value) : value, rule.limit);
        break;
      }
    }
  }
}

const USER_MESSAGE_RULES: ReadonlyArray<{
  test: (text: string) => boolean;
  section: WorkingMemorySectionKey;
}> = [
  {
    test: text => /\b(?:remember|always|never|prefer|preference|do not|don't|dont|make sure|use this|leave .* alone|keep .* there)\b/i.test(text),
    section: 'userPreferences',
  },
  {
    test: text => /\b(?:we decided|decision|go with|choose|chosen|selected|use .* instead|we will|we're going to|approved|confirmed)\b/i.test(text),
    section: 'importantDecisions',
  },
  {
    test: text => /\b(?:file|folder|pdf|docx|xlsx|workbook|artifact|canvas|knowledge base|rag|workspace|directory|path)\b/i.test(text),
    section: 'filesFoldersArtifacts',
  },
  {
    test: text => /\b(?:issue|problem|bug|error|failing|unable|broken|stuck|regression|missing)\b/i.test(text),
    section: 'currentStatus',
  },
  {
    test: text => /\?$/.test(text) || /\b(?:question|unclear|figure out|investigate|audit)\b/i.test(text),
    section: 'openQuestions',
  },
  {
    test: text => /\b(?:next|after this|one more thing|once done|then|follow up|lastly|before redeploy|redeploy|commit|push)\b/i.test(text),
    section: 'nextStep',
  },
];

function classifyUserMessage(content: string, memory: WorkingMemory, options: { isFirstUser: boolean }) {
  const text = summarizeText(content, 500);
  if (!text) return;

  if (options.isFirstUser && memory.objective.length === 0 && !isLowSignalWorkspacePrompt(text) && !isContinuationWorkspacePrompt(text)) {
    pushMemory(memory, 'objective', text, 1);
  }

  for (const rule of USER_MESSAGE_RULES) {
    if (rule.test(text)) pushMemory(memory, rule.section, text);
  }
}

const ASSISTANT_MESSAGE_RULES: ReadonlyArray<{
  test: (content: string) => boolean;
  section: WorkingMemorySectionKey;
}> = [
  {
    test: content => /\b(?:next step|follow up|remaining|todo|pending|should)\b/i.test(content),
    section: 'nextStep',
  },
];

function classifyAssistantMessage(message: SessionMessageLike, memory: WorkingMemory) {
  const content = summarizeText(message.content || '', 500);
  if (!content) return;

  if (message.toolRequest) {
    pushMemory(memory, 'filesFoldersArtifacts', `Assistant used ${message.toolRequest}: ${content}`);
  }

  // Assistant responses always update current status. The original
  // `message.role === 'assistant' || regex` was unconditional for assistant
  // messages (this function is only called for them), so the role guard alone
  // preserves the exact behavior.
  if (message.role === 'assistant') {
    pushMemory(memory, 'currentStatus', content);
  }

  for (const rule of ASSISTANT_MESSAGE_RULES) {
    if (rule.test(content)) pushMemory(memory, rule.section, content);
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

export function normalizeMaxToolRoundsPerTurn(value: unknown, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(250, Math.max(1, Math.round(parsed)));
}

function num(raw: Record<string, unknown>, key: string): number {
  return typeof raw[key] === 'number' ? (raw[key] as number) : 0;
}

export function normalizeSessionAnalytics(raw: unknown): SessionAnalytics | null {
  if (!isRecord(raw)) return null;

  const toolCallsByTypeValue = isRecord(raw.toolCallsByType) ? raw.toolCallsByType : {};
  const toolCallsByType: SessionAnalytics['toolCallsByType'] = {};

  for (const key of ['shell', 'filesystem', 'web', 'code', 'browser', 'unified_browser', 'tax_return', 'pdf_document', 'workbook_document', 'word_document', 'csv_document', 'email_document', 'markdown_document', 'slides_document', 'archive_document', 'calendar_document', 'mermaid_document', 'fetch_summarize', 'image_generation', 'notes_search', 'notes_save', 'http_request'] as const) {
    if (typeof toolCallsByTypeValue[key] === 'number') {
      toolCallsByType[key] = toolCallsByTypeValue[key] as number;
    }
  }

  return {
    totalMessages: num(raw, 'totalMessages'),
    visibleMessages: num(raw, 'visibleMessages'),
    hiddenMessages: num(raw, 'hiddenMessages'),
    userMessages: num(raw, 'userMessages'),
    assistantMessages: num(raw, 'assistantMessages'),
    systemMessages: num(raw, 'systemMessages'),
    toolCalls: num(raw, 'toolCalls'),
    toolCallsByType,
    assistantTokens: num(raw, 'assistantTokens'),
    assistantDurationSeconds: num(raw, 'assistantDurationSeconds'),
    averageTps: num(raw, 'averageTps'),
    sourceCount: num(raw, 'sourceCount'),
    imageCount: num(raw, 'imageCount'),
    attachmentCount: num(raw, 'attachmentCount'),
    firstMessageAt: typeof raw.firstMessageAt === 'string' ? raw.firstMessageAt : null,
    lastMessageAt: typeof raw.lastMessageAt === 'string' ? raw.lastMessageAt : null,
    timeSpanSeconds: num(raw, 'timeSpanSeconds'),
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
  let visibleMessages = 0;
  let hiddenMessages = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let systemMessages = 0;
  let assistantTokens = 0;
  let assistantDurationSeconds = 0;
  let totalTpsWeight = 0;
  let totalTpsSamples = 0;
  let sourceCount = 0;
  let imageCount = 0;
  let attachmentCount = 0;

  for (const message of messages) {
    if (message.hidden) hiddenMessages += 1;
    else visibleMessages += 1;

    if (message.role === 'user') userMessages += 1;
    else if (message.role === 'assistant') assistantMessages += 1;
    else if (message.role === 'system') systemMessages += 1;

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
    visibleMessages,
    hiddenMessages,
    userMessages,
    assistantMessages,
    systemMessages,
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
  let nonSystemCount = 0;
  for (const message of messages) {
    if (message.role !== 'system') nonSystemCount += 1;
  }
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
