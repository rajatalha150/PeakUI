import { prisma } from './prisma';
import { normalizeResponsePresentation, type ResponsePresentation } from './response-format';
import { normalizeMessageSources, type MessageSource } from './message-sources';
import { extractOpenClawToolRequest } from './openclaw-tools';
import { estimateMessageTokens } from './message-trim';
import { getUserSettings } from './settings';
import {
  buildSessionContextSummary,
  computeSessionAnalytics,
  normalizeSessionAnalytics,
  normalizeSessionAutoContinueMaxSteps,
  normalizeSessionAutoContinueMode,
  type SessionAnalytics,
  type SessionAutoContinueMode,
} from './session-intelligence';

export type StoredChatRole = 'user' | 'assistant' | 'system';
export type ChatSessionSurface = 'chat' | 'openclaw';

export interface StoredChatMessage {
  id?: string;
  role: StoredChatRole;
  content: string;
  hidden?: boolean;
  toolRequest?: 'shell' | 'filesystem' | 'web' | 'code' | 'browser' | 'unified_browser';
  thinking?: string;
  sources?: MessageSource[];
  images?: unknown[];
  attachments?: unknown[];
  presentation?: ResponsePresentation;
  meta?: unknown;
  createdAt?: string;
}

export interface ChatSessionDto {
  id: string;
  title: string;
  pinned: boolean;
  surface: ChatSessionSurface;
  messages: StoredChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  folderId: string | null;
  tags: { id: string; name: string; color: string }[];
  summary: string | null;
  contextSummary: string | null;
  contextSummaryUpdatedAt: Date | null;
  analytics: SessionAnalytics | null;
  autoContinueMode: SessionAutoContinueMode;
  autoContinueMaxSteps: number;
  lastAutoContinueAt: Date | null;
  parentSessionId: string | null;
  branchFromMessageId: string | null;
  branchLabel: string | null;
  branchChildrenCount: number;
  branchDepth: number;
}

export interface SaveChatSessionInput {
  id?: string;
  title?: string;
  messages?: unknown;
  pinned?: boolean;
  surface?: ChatSessionSurface;
  folderId?: string | null;
  autoContinueMode?: unknown;
  autoContinueMaxSteps?: unknown;
  branchLabel?: unknown;
  lastAutoContinueAt?: unknown;
}

export interface FinalizeChatSessionInput {
  chatId: string;
  messageId?: string;
  message: unknown;
  messages?: unknown;
  title?: string;
  surface?: ChatSessionSurface;
  autoContinueMode?: unknown;
  autoContinueMaxSteps?: unknown;
  branchLabel?: unknown;
  lastAutoContinueAt?: unknown;
}

export interface BranchChatSessionInput {
  sessionId: string;
  messageId?: string;
  branchLabel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRole(role: unknown): StoredChatRole | null {
  return role === 'user' || role === 'assistant' || role === 'system' ? role : null;
}

function normalizeSurface(surface: unknown): ChatSessionSurface {
  return surface === 'openclaw' ? 'openclaw' : 'chat';
}

function normalizeAttachmentName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeToolRequest(value: unknown): StoredChatMessage['toolRequest'] {
  return value === 'shell' || value === 'filesystem' || value === 'web' || value === 'code' || value === 'browser' || value === 'unified_browser'
    ? value
    : undefined;
}

function normalizeAssistantToolBridge(content: string) {
  if (!content.includes('<openclaw_tool')) {
    return {
      content,
      hidden: false,
      toolRequest: undefined as StoredChatMessage['toolRequest'],
    };
  }

  const extracted = extractOpenClawToolRequest(content);
  return {
    content: extracted.cleanedContent,
    hidden: true,
    toolRequest: extracted.request ? normalizeToolRequest(extracted.request.name) : undefined,
  };
}

function looksLikeHiddenToolResult(role: StoredChatRole, content: string) {
  if (role === 'assistant') return false;
  const trimmed = content.trim();
  return trimmed.startsWith('Shell command result:')
    || trimmed.startsWith('Filesystem tool result:')
    || trimmed.startsWith('Web research tool result:')
    || trimmed.startsWith('Code execution result:')
    || trimmed.startsWith('Browser tool result:')
    || trimmed.startsWith('UWAF browser tool result:');
}

function normalizeMessageCreatedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function normalizeStoredChatMessage(raw: unknown): StoredChatMessage | null {
  if (!isRecord(raw)) return null;

  const role = normalizeRole(raw.role);
  if (!role) return null;

  const rawContent = typeof raw.content === 'string' ? raw.content : '';
  const toolBridge = role === 'assistant'
    ? normalizeAssistantToolBridge(rawContent)
    : null;
  const content = toolBridge ? toolBridge.content : rawContent;
  const hidden = raw.hidden === true || looksLikeHiddenToolResult(role, content) || Boolean(toolBridge?.hidden);
  const toolRequest = toolBridge?.toolRequest ?? normalizeToolRequest(raw.toolRequest);
  const thinking = typeof raw.thinking === 'string' ? raw.thinking : undefined;
  const meta = raw.meta ?? undefined;
  const sources = normalizeMessageSources(raw.sources);
  const images = Array.isArray(raw.images) ? raw.images : undefined;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : undefined;
  const presentation = normalizeResponsePresentation(raw.presentation);
  const createdAt = normalizeMessageCreatedAt(raw.createdAt);
  const hasPayload =
    content.trim().length > 0 ||
    Boolean(thinking?.trim()) ||
    Boolean(sources.length) ||
    Boolean(images?.length) ||
    Boolean(attachments?.length) ||
    presentation.mode !== 'general' ||
    Boolean(typeof raw.id === 'string' && raw.id.trim());

  if (!hasPayload) return null;

  const message: StoredChatMessage = { role, content };
  if (typeof raw.id === 'string' && raw.id.trim()) message.id = raw.id.trim();
  if (hidden) message.hidden = true;
  if (toolRequest) message.toolRequest = toolRequest;
  if (thinking?.trim()) message.thinking = thinking;
  if (sources.length) message.sources = sources;
  if (images) message.images = images;
  if (attachments) message.attachments = attachments;
  if (presentation.mode !== 'general') message.presentation = presentation;
  if (meta !== undefined) message.meta = meta;
  if (createdAt) message.createdAt = createdAt;

  return message;
}

function ensureMessageTimestamps(messages: StoredChatMessage[], fallbackIso: string) {
  let cursor = new Date(fallbackIso).getTime();
  return messages.map(message => {
    if (message.createdAt) {
      const parsed = new Date(message.createdAt).getTime();
      if (!Number.isNaN(parsed)) {
        cursor = parsed;
        return message;
      }
    }

    cursor += 1000;
    return {
      ...message,
      createdAt: new Date(cursor).toISOString(),
    };
  });
}

export function normalizeStoredChatMessages(messages: unknown): StoredChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map(normalizeStoredChatMessage).filter((message): message is StoredChatMessage => Boolean(message));
}

export function parseStoredChatMessages(raw: string | null | undefined): StoredChatMessage[] {
  if (!raw) return [];

  try {
    return normalizeStoredChatMessages(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeStoredChatMessages(messages: StoredChatMessage[]): string {
  return JSON.stringify(messages);
}

function describeFirstMessage(message: StoredChatMessage): string {
  const attachmentNames = (message.attachments ?? [])
    .map(attachment => {
      if (isRecord(attachment)) {
        return normalizeAttachmentName(attachment.name);
      }
      return '';
    })
    .filter(Boolean);

  if (attachmentNames.length > 0) return attachmentNames.join(', ');
  if (message.images?.length) return 'Image chat';
  return message.content.trim();
}

export function deriveChatTitle(messages: StoredChatMessage[]): string {
  const firstMessage = messages.find(message => message.role !== 'system');
  const titleSource = firstMessage ? describeFirstMessage(firstMessage) : '';
  const fallback = 'New Chat';
  const base = titleSource.trim() || fallback;
  return base.substring(0, 30) + (base.length > 30 ? '...' : '');
}

type SessionRecord = {
  id: string;
  title: string;
  messages: string;
  summary: string | null;
  contextSummary: string | null;
  contextSummaryUpdatedAt: Date | null;
  analyticsJson: string;
  autoContinueMode: string;
  autoContinueMaxSteps: number;
  lastAutoContinueAt: Date | null;
  parentSessionId: string | null;
  branchFromMessageId: string | null;
  branchLabel: string | null;
  pinned: boolean;
  surface: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string | null;
  tags: { id: string; name: string; color: string }[];
  branchChildrenCount: number;
};

function computeBranchDepth(sessionId: string, parentById: Map<string, string | null>, cache = new Map<string, number>()): number {
  if (cache.has(sessionId)) return cache.get(sessionId)!;

  const seen = new Set<string>();
  let depth = 0;
  let cursor = parentById.get(sessionId) ?? null;

  while (cursor) {
    if (cache.has(cursor)) {
      depth += cache.get(cursor)! + 1;
      break;
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    depth += 1;
    cursor = parentById.get(cursor) ?? null;
  }

  cache.set(sessionId, depth);
  return depth;
}

function parseAnalyticsJson(value: string): SessionAnalytics | null {
  try {
    return normalizeSessionAnalytics(JSON.parse(value || '{}'));
  } catch {
    return null;
  }
}

function toClientSession(
  session: SessionRecord,
  branchDepth = 0,
): ChatSessionDto {
  return {
    id: session.id,
    title: session.title,
    pinned: session.pinned,
    surface: normalizeSurface(session.surface),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: parseStoredChatMessages(session.messages),
    folderId: session.folderId,
    tags: session.tags,
    summary: session.summary,
    contextSummary: session.contextSummary,
    contextSummaryUpdatedAt: session.contextSummaryUpdatedAt,
    analytics: parseAnalyticsJson(session.analyticsJson),
    autoContinueMode: normalizeSessionAutoContinueMode(session.autoContinueMode),
    autoContinueMaxSteps: normalizeSessionAutoContinueMaxSteps(session.autoContinueMaxSteps, 3),
    lastAutoContinueAt: session.lastAutoContinueAt,
    parentSessionId: session.parentSessionId,
    branchFromMessageId: session.branchFromMessageId,
    branchLabel: session.branchLabel,
    branchChildrenCount: session.branchChildrenCount,
    branchDepth,
  };
}

async function getOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) return null;
  return session;
}

async function buildDerivedSessionState(
  userId: string,
  messages: StoredChatMessage[],
  sessionCreatedAt?: Date | null,
  sessionUpdatedAt?: Date | null,
) {
  const settings = await getUserSettings(userId);
  const analytics = settings.openClawSessionAnalyticsEnabled
    ? computeSessionAnalytics(messages, {
        fallbackCreatedAt: sessionCreatedAt ?? null,
        fallbackUpdatedAt: sessionUpdatedAt ?? null,
      })
    : null;
  const contextSummary = settings.openClawSessionSummariesEnabled
    && estimateMessageTokens(messages) >= settings.openClawSessionSummaryTargetTokens
      ? buildSessionContextSummary(messages, {
          preserveTurns: settings.openClawSessionPreserveTurns,
        })
      : '';

  return {
    analytics,
    contextSummary: contextSummary || null,
    contextSummaryUpdatedAt: contextSummary ? new Date() : null,
  };
}

function normalizeLastAutoContinueAt(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function buildSessionData(
  userId: string,
  input: SaveChatSessionInput,
  existing?: {
    title: string;
    messages: string;
    pinned: boolean;
    surface: string;
    folderId: string | null;
    autoContinueMode: string;
    autoContinueMaxSteps: number;
    branchLabel: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  const fallbackIso = existing?.updatedAt?.toISOString() || new Date().toISOString();
  const normalizedMessages = ensureMessageTimestamps(normalizeStoredChatMessages(input.messages), fallbackIso);
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim()
    : deriveChatTitle(normalizedMessages);
  const derived = await buildDerivedSessionState(
    userId,
    normalizedMessages,
    existing?.createdAt ?? null,
    new Date(),
  );

  return {
    title,
    messages: normalizedMessages,
    pinned: Boolean(input.pinned ?? existing?.pinned),
    surface: normalizeSurface(input.surface ?? existing?.surface),
    folderId: input.folderId !== undefined ? input.folderId : existing?.folderId ?? null,
    autoContinueMode: normalizeSessionAutoContinueMode(input.autoContinueMode ?? existing?.autoContinueMode),
    autoContinueMaxSteps: normalizeSessionAutoContinueMaxSteps(
      input.autoContinueMaxSteps ?? existing?.autoContinueMaxSteps,
      3,
    ),
    branchLabel: typeof input.branchLabel === 'string'
      ? input.branchLabel.trim() || null
      : existing?.branchLabel ?? null,
    lastAutoContinueAt: normalizeLastAutoContinueAt(input.lastAutoContinueAt),
    ...derived,
  };
}

function mergeAssistantMessage(messages: StoredChatMessage[], assistantMessage: StoredChatMessage): StoredChatMessage[] {
  const nextMessages = [...messages];

  if (assistantMessage.id) {
    const indexed = nextMessages.findIndex(message => message?.id === assistantMessage.id);
    if (indexed !== -1) {
      nextMessages[indexed] = {
        ...nextMessages[indexed],
        ...assistantMessage,
        role: 'assistant',
        createdAt: nextMessages[indexed].createdAt || assistantMessage.createdAt || new Date().toISOString(),
      };
      return nextMessages;
    }
  }

  const lastMessage = nextMessages[nextMessages.length - 1];
  if (lastMessage?.role === 'assistant' && (!lastMessage.content.trim() || lastMessage.id === assistantMessage.id)) {
    nextMessages[nextMessages.length - 1] = {
      ...lastMessage,
      ...assistantMessage,
      role: 'assistant',
      createdAt: lastMessage.createdAt || assistantMessage.createdAt || new Date().toISOString(),
    };
    return nextMessages;
  }

  nextMessages.push({
    ...assistantMessage,
    role: 'assistant',
    createdAt: assistantMessage.createdAt || new Date().toISOString(),
  });
  return nextMessages;
}

function mapSessionRows(rows: Array<{
  id: string;
  title: string;
  messages: string;
  summary: string | null;
  contextSummary: string | null;
  contextSummaryUpdatedAt: Date | null;
  analyticsJson: string;
  autoContinueMode: string;
  autoContinueMaxSteps: number;
  lastAutoContinueAt: Date | null;
  parentSessionId: string | null;
  branchFromMessageId: string | null;
  branchLabel: string | null;
  pinned: boolean;
  surface: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string | null;
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
  _count: { childSessions: number };
}>): ChatSessionDto[] {
  const parentById = new Map(rows.map(row => [row.id, row.parentSessionId]));
  const depthCache = new Map<string, number>();
  return rows.map(row => toClientSession({
    ...row,
    tags: row.tags.map(tag => ({ id: tag.tag.id, name: tag.tag.name, color: tag.tag.color })),
    branchChildrenCount: row._count.childSessions,
  }, computeBranchDepth(row.id, parentById, depthCache)));
}

export async function listChatSessions(userId: string, surface: ChatSessionSurface = 'chat', folderId?: string | null): Promise<ChatSessionDto[]> {
  const sessions = await prisma.chatSession.findMany({
    where: {
      userId,
      surface,
      ...(folderId !== undefined ? { folderId: folderId || undefined } : {}),
    },
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
      _count: {
        select: {
          childSessions: true,
        },
      },
    },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
  });

  return mapSessionRows(sessions);
}

export async function getChatSessionById(userId: string, sessionId: string): Promise<ChatSessionDto | null> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      tags: { include: { tag: true } },
      _count: { select: { childSessions: true } },
    },
  });

  if (!session || session.userId !== userId) return null;

  return mapSessionRows([session])[0] ?? null;
}

export async function upsertChatSession(userId: string, input: SaveChatSessionInput): Promise<{ created: boolean; session: ChatSessionDto }> {
  const requestedId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '';

  if (requestedId) {
    const existing = await prisma.chatSession.findUnique({ where: { id: requestedId } });

    if (existing) {
      if (existing.userId !== userId) {
        throw new Error('Unauthorized');
      }

      const payload = await buildSessionData(userId, {
        id: requestedId,
        title: input.title ?? existing.title,
        messages: input.messages ?? parseStoredChatMessages(existing.messages),
        pinned: input.pinned ?? existing.pinned,
        surface: input.surface ?? normalizeSurface(existing.surface),
        folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
        autoContinueMode: input.autoContinueMode ?? existing.autoContinueMode,
        autoContinueMaxSteps: input.autoContinueMaxSteps ?? existing.autoContinueMaxSteps,
        branchLabel: input.branchLabel ?? existing.branchLabel,
        lastAutoContinueAt: input.lastAutoContinueAt,
      }, existing);

      const updated = await prisma.chatSession.update({
        where: { id: requestedId },
        data: {
          title: payload.title,
          messages: serializeStoredChatMessages(payload.messages),
          pinned: payload.pinned,
          surface: payload.surface,
          folderId: payload.folderId,
          autoContinueMode: payload.autoContinueMode,
          autoContinueMaxSteps: payload.autoContinueMaxSteps,
          branchLabel: payload.branchLabel,
          contextSummary: payload.contextSummary,
          contextSummaryUpdatedAt: payload.contextSummaryUpdatedAt,
          analyticsJson: JSON.stringify(payload.analytics ?? {}),
          ...(payload.lastAutoContinueAt ? { lastAutoContinueAt: payload.lastAutoContinueAt } : {}),
          updatedAt: new Date(),
        },
        include: {
          tags: { include: { tag: true } },
          _count: { select: { childSessions: true } },
        },
      });

      return { created: false, session: mapSessionRows([updated])[0]! };
    }
  }

  const payload = await buildSessionData(userId, input);
  const created = await prisma.chatSession.create({
    data: {
      id: requestedId || undefined,
      userId,
      title: payload.title,
      messages: serializeStoredChatMessages(payload.messages),
      pinned: payload.pinned,
      surface: payload.surface,
      folderId: payload.folderId,
      autoContinueMode: payload.autoContinueMode,
      autoContinueMaxSteps: payload.autoContinueMaxSteps,
      branchLabel: payload.branchLabel,
      contextSummary: payload.contextSummary,
      contextSummaryUpdatedAt: payload.contextSummaryUpdatedAt,
      analyticsJson: JSON.stringify(payload.analytics ?? {}),
      ...(payload.lastAutoContinueAt ? { lastAutoContinueAt: payload.lastAutoContinueAt } : {}),
    },
    include: {
      tags: { include: { tag: true } },
      _count: { select: { childSessions: true } },
    },
  });

  return { created: true, session: mapSessionRows([created])[0]! };
}

export async function updateChatSession(
  userId: string,
  sessionId: string,
  input: SaveChatSessionInput,
): Promise<ChatSessionDto | null> {
  const existing = await getOwnedSession(userId, sessionId);
  if (!existing) return null;

  const payload = await buildSessionData(userId, {
    id: sessionId,
    title: input.title ?? existing.title,
    messages: input.messages ?? parseStoredChatMessages(existing.messages),
    pinned: input.pinned ?? existing.pinned,
    surface: input.surface ?? normalizeSurface(existing.surface),
    folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
    autoContinueMode: input.autoContinueMode ?? existing.autoContinueMode,
    autoContinueMaxSteps: input.autoContinueMaxSteps ?? existing.autoContinueMaxSteps,
    branchLabel: input.branchLabel ?? existing.branchLabel,
    lastAutoContinueAt: input.lastAutoContinueAt,
  }, existing);

  const updated = await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      title: payload.title,
      messages: serializeStoredChatMessages(payload.messages),
      pinned: payload.pinned,
      surface: payload.surface,
      folderId: payload.folderId,
      autoContinueMode: payload.autoContinueMode,
      autoContinueMaxSteps: payload.autoContinueMaxSteps,
      branchLabel: payload.branchLabel,
      contextSummary: payload.contextSummary,
      contextSummaryUpdatedAt: payload.contextSummaryUpdatedAt,
      analyticsJson: JSON.stringify(payload.analytics ?? {}),
      ...(payload.lastAutoContinueAt ? { lastAutoContinueAt: payload.lastAutoContinueAt } : {}),
      updatedAt: new Date(),
    },
    include: {
      tags: { include: { tag: true } },
      _count: { select: { childSessions: true } },
    },
  });

  return mapSessionRows([updated])[0] ?? null;
}

export async function deleteChatSession(userId: string, sessionId: string): Promise<boolean> {
  const existing = await getOwnedSession(userId, sessionId);
  if (!existing) return false;

  await prisma.chatSession.delete({ where: { id: sessionId } });
  return true;
}

export async function deleteChatSessions(
  userId: string,
  options: {
    ids?: string[]
    surface?: ChatSessionSurface
  } = {},
): Promise<{ count: number }> {
  const ids = Array.isArray(options.ids)
    ? Array.from(new Set(options.ids.map(id => typeof id === 'string' ? id.trim() : '').filter(Boolean)))
    : [];

  if (ids.length > 0) {
    const result = await prisma.chatSession.deleteMany({
      where: {
        userId,
        id: { in: ids },
      },
    });
    return { count: result.count };
  }

  if (options.surface) {
    const result = await prisma.chatSession.deleteMany({
      where: {
        userId,
        surface: normalizeSurface(options.surface),
      },
    });
    return { count: result.count };
  }

  return { count: 0 };
}

export async function finalizeChatSession(
  userId: string,
  input: FinalizeChatSessionInput,
): Promise<ChatSessionDto | null> {
  const existing = await prisma.chatSession.findUnique({
    where: { id: input.chatId },
    include: {
      tags: { include: { tag: true } },
      _count: { select: { childSessions: true } },
    },
  });
  if (existing && existing.userId !== userId) return null;

  const baseMessages = input.messages !== undefined
    ? normalizeStoredChatMessages(input.messages)
    : parseStoredChatMessages(existing?.messages);

  const assistantMessage = normalizeStoredChatMessage({
    ...(isRecord(input.message) ? input.message : {}),
    role: 'assistant',
    id: input.messageId,
    createdAt: isRecord(input.message) ? input.message.createdAt : undefined,
  });

  if (!assistantMessage) return null;

  const nextMessages = mergeAssistantMessage(baseMessages, assistantMessage);
  const nextTitle = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim()
    : existing?.title && existing.title !== 'New Chat'
      ? existing.title
      : deriveChatTitle(nextMessages);
  const derived = await buildDerivedSessionState(
    userId,
    nextMessages,
    existing?.createdAt ?? null,
    new Date(),
  );
  const userSettings = existing ? null : await getUserSettings(userId);
  const nextAutoContinueMode = normalizeSessionAutoContinueMode(
    input.autoContinueMode
    ?? existing?.autoContinueMode
    ?? userSettings?.openClawSessionAutoContinueDefault,
  );
  const nextAutoContinueMaxSteps = normalizeSessionAutoContinueMaxSteps(
    input.autoContinueMaxSteps
    ?? existing?.autoContinueMaxSteps
    ?? userSettings?.openClawSessionAutoContinueMaxSteps,
    3,
  );
  const nextBranchLabel = typeof input.branchLabel === 'string'
    ? input.branchLabel.trim() || null
    : existing?.branchLabel ?? null;
  const nextLastAutoContinueAt = normalizeLastAutoContinueAt(input.lastAutoContinueAt) ?? existing?.lastAutoContinueAt ?? null;

  const saved = existing
    ? await prisma.chatSession.update({
        where: { id: input.chatId },
        data: {
          title: nextTitle,
          messages: serializeStoredChatMessages(nextMessages),
          surface: normalizeSurface(input.surface ?? existing.surface),
          autoContinueMode: nextAutoContinueMode,
          autoContinueMaxSteps: nextAutoContinueMaxSteps,
          branchLabel: nextBranchLabel,
          contextSummary: derived.contextSummary,
          contextSummaryUpdatedAt: derived.contextSummaryUpdatedAt,
          analyticsJson: JSON.stringify(derived.analytics ?? {}),
          lastAutoContinueAt: nextLastAutoContinueAt,
          updatedAt: new Date(),
        },
        include: {
          tags: { include: { tag: true } },
          _count: { select: { childSessions: true } },
        },
      })
    : await prisma.chatSession.create({
        data: {
          id: input.chatId,
          userId,
          title: nextTitle,
          messages: serializeStoredChatMessages(nextMessages),
          surface: normalizeSurface(input.surface),
          autoContinueMode: nextAutoContinueMode,
          autoContinueMaxSteps: nextAutoContinueMaxSteps,
          branchLabel: nextBranchLabel,
          contextSummary: derived.contextSummary,
          contextSummaryUpdatedAt: derived.contextSummaryUpdatedAt,
          analyticsJson: JSON.stringify(derived.analytics ?? {}),
          lastAutoContinueAt: nextLastAutoContinueAt,
        },
        include: {
          tags: { include: { tag: true } },
          _count: { select: { childSessions: true } },
        },
      });

  return mapSessionRows([saved])[0] ?? null;
}

export async function branchChatSession(
  userId: string,
  input: BranchChatSessionInput,
): Promise<ChatSessionDto | null> {
  const existing = await prisma.chatSession.findUnique({
    where: { id: input.sessionId },
    include: {
      tags: true,
    },
  });
  if (!existing || existing.userId !== userId) return null;

  const sourceMessages = parseStoredChatMessages(existing.messages);
  const branchIndex = input.messageId
    ? sourceMessages.findIndex(message => message.id === input.messageId)
    : sourceMessages.length - 1;

  if (branchIndex < 0) {
    throw new Error('Branch point message not found');
  }

  const branchMessages = sourceMessages.slice(0, branchIndex + 1);
  const derived = await buildDerivedSessionState(
    userId,
    branchMessages,
    existing.createdAt,
    new Date(),
  );
  const branchLabel = input.branchLabel?.trim() || `Branch from ${existing.title}`;
  const created = await prisma.chatSession.create({
    data: {
      userId,
      title: `${existing.title} · Branch`,
      messages: serializeStoredChatMessages(branchMessages),
      summary: existing.summary,
      contextSummary: derived.contextSummary,
      contextSummaryUpdatedAt: derived.contextSummaryUpdatedAt,
      analyticsJson: JSON.stringify(derived.analytics ?? {}),
      autoContinueMode: normalizeSessionAutoContinueMode(existing.autoContinueMode),
      autoContinueMaxSteps: normalizeSessionAutoContinueMaxSteps(existing.autoContinueMaxSteps, 3),
      parentSessionId: existing.id,
      branchFromMessageId: input.messageId || branchMessages[branchMessages.length - 1]?.id || null,
      branchLabel,
      surface: normalizeSurface(existing.surface),
      folderId: existing.folderId,
    },
    include: {
      tags: { include: { tag: true } },
      _count: { select: { childSessions: true } },
    },
  });

  if (existing.tags.length > 0) {
    await prisma.chatSessionTag.createMany({
      data: existing.tags.map(tag => ({
        sessionId: created.id,
        tagId: tag.tagId,
      })),
      skipDuplicates: true,
    });
  }

  return getChatSessionById(userId, created.id);
}
