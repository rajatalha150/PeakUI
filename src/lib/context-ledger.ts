import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { buildSessionContextSummary } from './session-intelligence'
import { deriveEpisodeRange, estimateContextMessages, scoreContextMemory, type ContextModelProfile, type ContextSourceMessage } from './context-engine'
import type { StoredChatMessage } from './chat-sessions'

const MAX_RECALLED_EPISODES = 3
const MAX_RECALLED_CHARS = 5_000

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function coderToolEvidence(message: StoredChatMessage): string {
  if (!message.meta || typeof message.meta !== 'object' || Array.isArray(message.meta)) return ''
  const activity = (message.meta as Record<string, unknown>).toolActivity
  if (!Array.isArray(activity)) return ''
  const lines = activity.slice(-24).flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title : 'tool'
    const status = typeof record.status === 'string' ? record.status : ''
    const detail = typeof record.detail === 'string' ? record.detail.slice(0, 2_000) : ''
    const output = typeof record.rawOutput === 'string' ? record.rawOutput.slice(0, 6_000) : ''
    return [`[Coder tool ${title}${status ? ` (${status})` : ''}]`, detail, output].filter(Boolean)
  })
  return lines.length ? `\n\n${lines.join('\n')}` : ''
}

function asSourceMessages(messages: StoredChatMessage[]): ContextSourceMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: `${message.content}${coderToolEvidence(message)}`.slice(0, 80_000),
    hidden: message.hidden,
    images: message.images,
  }))
}

function parseTimestamp(value: string | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export interface RecordContextLedgerInput {
  sessionId: string
  messages: StoredChatMessage[]
  workingMemory: string | null
  profile: ContextModelProfile
  preserveTurns: number
}

/**
 * Append normalized transcript entries and capture a source-linked checkpoint.
 * A changed streaming message produces a new hash-version instead of rewriting
 * prior evidence. The visible ChatSession transcript remains the product's
 * compatibility source of truth.
 */
export async function recordContextLedger(input: RecordContextLedgerInput): Promise<void> {
  const messages = asSourceMessages(input.messages)
  if (messages.length === 0) return

  await prisma.contextEvent.createMany({
    data: messages.map((message, ordinal) => ({
      sessionId: input.sessionId,
      ordinal,
      role: message.role,
      content: message.content,
      contentHash: digest(`${message.role}\n${message.hidden ? '1' : '0'}\n${message.content}`),
      hidden: Boolean(message.hidden),
      createdAt: parseTimestamp(input.messages[ordinal]?.createdAt),
    })),
    skipDuplicates: true,
  })

  const episodeRange = deriveEpisodeRange(messages, input.preserveTurns)
  if (!episodeRange) return

  const episodeMessages = messages.slice(episodeRange.startOrdinal, episodeRange.endOrdinal + 1)
  const episodeSummary = buildSessionContextSummary(episodeMessages, { preserveTurns: 0 }) || input.workingMemory || 'Completed earlier work. Open its source events before relying on details.'
  const episode = await prisma.contextEpisode.upsert({
    where: {
      sessionId_startOrdinal_endOrdinal: {
        sessionId: input.sessionId,
        startOrdinal: episodeRange.startOrdinal,
        endOrdinal: episodeRange.endOrdinal,
      },
    },
    create: {
      sessionId: input.sessionId,
      startOrdinal: episodeRange.startOrdinal,
      endOrdinal: episodeRange.endOrdinal,
      summary: episodeSummary,
      searchText: `${episodeSummary}\n${episodeMessages.map(message => message.content).join('\n')}`.slice(0, 80_000),
      tokenEstimate: estimateContextMessages(episodeMessages),
    },
    update: {
      summary: episodeSummary,
      searchText: `${episodeSummary}\n${episodeMessages.map(message => message.content).join('\n')}`.slice(0, 80_000),
      tokenEstimate: estimateContextMessages(episodeMessages),
    },
  })

  const checkpoint = input.workingMemory || episodeSummary
  const latestSnapshot = await prisma.contextSnapshot.findFirst({
    where: { sessionId: input.sessionId, episodeId: episode.id },
    orderBy: { createdAt: 'desc' },
    select: { summary: true, sourceStart: true, sourceEnd: true },
  })
  if (latestSnapshot
    && latestSnapshot.summary === checkpoint
    && latestSnapshot.sourceStart === episodeRange.startOrdinal
    && latestSnapshot.sourceEnd === episodeRange.endOrdinal) {
    return
  }
  await prisma.contextSnapshot.create({
    data: {
      sessionId: input.sessionId,
      episodeId: episode.id,
      provider: input.profile.provider,
      model: input.profile.model,
      summary: checkpoint,
      sourceStart: episodeRange.startOrdinal,
      sourceEnd: episodeRange.endOrdinal,
      tokenEstimate: estimateContextMessages(messages),
    },
  })
}

export interface ContextRecall {
  content: string
  episodeIds: string[]
}

/** Store a provider-native handoff without pretending it is PeakUI's summary. */
export async function recordNativeContextHandoff(input: {
  sessionId: string
  provider: string
  model: string
  summary: string
  tokenEstimate: number
}): Promise<void> {
  const latestEvent = await prisma.contextEvent.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: [{ ordinal: 'desc' }, { recordedAt: 'desc' }],
    select: { ordinal: true },
  })
  const sourceEnd = latestEvent?.ordinal ?? 0
  await prisma.contextSnapshot.create({
    data: {
      sessionId: input.sessionId,
      provider: input.provider,
      model: input.model,
      kind: 'provider-recap',
      summary: input.summary.slice(0, 12_000),
      sourceStart: 0,
      sourceEnd,
      tokenEstimate: Math.max(0, Math.floor(input.tokenEstimate)),
    },
  })
}

/**
 * Retrieval is intentionally source-addressable. The model receives a small
 * recall note plus event ordinal ranges, never a vague free-floating summary.
 * This lexical fallback works on every Postgres installation; a pgvector
 * retriever can be added behind this contract without changing callers.
 */
export async function recallContextEpisodes(sessionId: string, query: string): Promise<ContextRecall> {
  const episodes = await prisma.contextEpisode.findMany({
    where: { sessionId },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    select: {
      id: true,
      startOrdinal: true,
      endOrdinal: true,
      summary: true,
      searchText: true,
    },
  })
  const selected = episodes
    .map(episode => ({ ...episode, score: scoreContextMemory(query, episode.searchText) }))
    .filter(episode => episode.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RECALLED_EPISODES)

  if (selected.length === 0) return { content: '', episodeIds: [] }
  let remaining = MAX_RECALLED_CHARS
  const blocks = selected.map(episode => {
    const summary = episode.summary.slice(0, remaining)
    remaining -= summary.length
    return `[Context episode ${episode.id}; source events ${episode.startOrdinal}-${episode.endOrdinal}]\n${summary}`
  }).filter(Boolean)

  return {
    content: blocks.join('\n\n'),
    episodeIds: selected.map(episode => episode.id),
  }
}
