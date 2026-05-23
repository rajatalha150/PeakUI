import { prisma } from './prisma';
import { normalizeResponsePresentation, type ResponsePresentation } from './response-format';
import { normalizeMessageSources, type MessageSource } from './message-sources';
import { extractOpenClawToolRequest } from './openclaw-tools';

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
}

export interface SaveChatSessionInput {
  id?: string;
  title?: string;
  messages?: unknown;
  pinned?: boolean;
  surface?: ChatSessionSurface;
  folderId?: string | null;
}

export interface FinalizeChatSessionInput {
  chatId: string;
  messageId?: string;
  message: unknown;
  messages?: unknown;
  title?: string;
  surface?: ChatSessionSurface;
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

  return message;
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

function toClientSession(session: {
  id: string;
  title: string;
  messages: string;
  pinned: boolean;
  surface: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string | null;
  tags: { id: string; name: string; color: string }[];
}): ChatSessionDto {
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
  };
}

async function getOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) return null;
  return session;
}

function buildSessionData(input: SaveChatSessionInput) {
  const messages = normalizeStoredChatMessages(input.messages);
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim()
    : deriveChatTitle(messages);

  return {
    title,
    messages,
    pinned: Boolean(input.pinned),
    surface: normalizeSurface(input.surface),
    folderId: input.folderId ?? null,
  };
}

function mergeAssistantMessage(messages: StoredChatMessage[], assistantMessage: StoredChatMessage): StoredChatMessage[] {
  const nextMessages = [...messages];

  if (assistantMessage.id) {
    const indexed = nextMessages.findIndex(message => message?.id === assistantMessage.id);
    if (indexed !== -1) {
      nextMessages[indexed] = { ...nextMessages[indexed], ...assistantMessage, role: 'assistant' };
      return nextMessages;
    }
  }

  const lastMessage = nextMessages[nextMessages.length - 1];
  if (lastMessage?.role === 'assistant' && (!lastMessage.content.trim() || lastMessage.id === assistantMessage.id)) {
    nextMessages[nextMessages.length - 1] = { ...lastMessage, ...assistantMessage, role: 'assistant' };
    return nextMessages;
  }

  nextMessages.push({ ...assistantMessage, role: 'assistant' });
  return nextMessages;
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
    },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
  });

  return sessions.map(s => toClientSession({
    ...s,
    tags: s.tags.map(t => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
  }));
}

export async function upsertChatSession(userId: string, input: SaveChatSessionInput): Promise<{ created: boolean; session: ChatSessionDto }> {
  const requestedId = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '';

  if (requestedId) {
    const existing = await prisma.chatSession.findUnique({ where: { id: requestedId } });

    if (existing) {
      if (existing.userId !== userId) {
        throw new Error('Unauthorized');
      }

      const payload = buildSessionData({
        id: requestedId,
        title: input.title ?? existing.title,
        messages: input.messages ?? parseStoredChatMessages(existing.messages),
        pinned: input.pinned ?? existing.pinned,
        surface: input.surface ?? normalizeSurface(existing.surface),
        folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
      });

      const updated = await prisma.chatSession.update({
        where: { id: requestedId },
        data: {
          title: payload.title,
          messages: serializeStoredChatMessages(payload.messages),
          pinned: payload.pinned,
          surface: payload.surface,
          folderId: payload.folderId,
          updatedAt: new Date(),
        },
      });

      // Fetch tags for response
      const tags = await prisma.chatSessionTag.findMany({
        where: { sessionId: requestedId },
        include: { tag: true },
      });

      return { created: false, session: toClientSession({
        id: updated.id,
        title: updated.title,
        messages: updated.messages,
        pinned: updated.pinned,
        surface: updated.surface,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        folderId: updated.folderId,
        tags: tags.map(t => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      })};
    }
  }

  const payload = buildSessionData(input);
  const created = await prisma.chatSession.create({
    data: {
      id: requestedId || undefined,
      userId,
      title: payload.title,
      messages: serializeStoredChatMessages(payload.messages),
      pinned: payload.pinned,
      surface: payload.surface,
      folderId: payload.folderId,
    },
  });

  return { created: true, session: toClientSession({
    id: created.id,
    title: created.title,
    messages: created.messages,
    pinned: created.pinned,
    surface: created.surface,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    folderId: created.folderId,
    tags: [],
  })};
}

export async function updateChatSession(
  userId: string,
  sessionId: string,
  input: SaveChatSessionInput,
): Promise<ChatSessionDto | null> {
  const existing = await getOwnedSession(userId, sessionId);
  if (!existing) return null;

  const payload = buildSessionData({
    id: sessionId,
    title: input.title ?? existing.title,
    messages: input.messages ?? parseStoredChatMessages(existing.messages),
    pinned: input.pinned ?? existing.pinned,
    surface: input.surface ?? normalizeSurface(existing.surface),
    folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
  });

  const updated = await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      title: payload.title,
      messages: serializeStoredChatMessages(payload.messages),
      pinned: payload.pinned,
      surface: payload.surface,
      folderId: payload.folderId,
      updatedAt: new Date(),
    },
  });

  const tags = await prisma.chatSessionTag.findMany({
    where: { sessionId },
    include: { tag: true },
  });

  return toClientSession({
    id: updated.id,
    title: updated.title,
    messages: updated.messages,
    pinned: updated.pinned,
    surface: updated.surface,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    folderId: updated.folderId,
    tags: tags.map(t => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
  });
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
    : []

  if (ids.length > 0) {
    const result = await prisma.chatSession.deleteMany({
      where: {
        userId,
        id: { in: ids },
      },
    })
    return { count: result.count }
  }

  if (options.surface) {
    const result = await prisma.chatSession.deleteMany({
      where: {
        userId,
        surface: normalizeSurface(options.surface),
      },
    })
    return { count: result.count }
  }

  return { count: 0 }
}

export async function finalizeChatSession(
  userId: string,
  input: FinalizeChatSessionInput,
): Promise<ChatSessionDto | null> {
  const existing = await prisma.chatSession.findUnique({ where: { id: input.chatId } });
  if (existing && existing.userId !== userId) return null;

  const baseMessages = input.messages !== undefined
    ? normalizeStoredChatMessages(input.messages)
    : parseStoredChatMessages(existing?.messages);

  const assistantMessage = normalizeStoredChatMessage({
    ...(isRecord(input.message) ? input.message : {}),
    role: 'assistant',
    id: input.messageId,
  });

  if (!assistantMessage) return null;

  const nextMessages = mergeAssistantMessage(baseMessages, assistantMessage);
  const nextTitle = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim()
    : existing?.title && existing.title !== 'New Chat'
      ? existing.title
      : deriveChatTitle(nextMessages);

  const saved = existing
    ? await prisma.chatSession.update({
        where: { id: input.chatId },
        data: {
          title: nextTitle,
          messages: serializeStoredChatMessages(nextMessages),
          surface: normalizeSurface(input.surface ?? existing.surface),
          updatedAt: new Date(),
        },
      })
    : await prisma.chatSession.create({
        data: {
          id: input.chatId,
          userId,
          title: nextTitle,
          messages: serializeStoredChatMessages(nextMessages),
          surface: normalizeSurface(input.surface),
        },
      });

  const tags = await prisma.chatSessionTag.findMany({
    where: { sessionId: saved.id },
    include: { tag: true },
  });

  return toClientSession({
    id: saved.id,
    title: saved.title,
    messages: saved.messages,
    pinned: saved.pinned,
    surface: saved.surface,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    folderId: saved.folderId,
    tags: tags.map(t => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
  });
}
