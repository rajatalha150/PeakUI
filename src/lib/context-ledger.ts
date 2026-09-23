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

function asSourceMessages(messages: StoredChatMessage[]): ContextSourceMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
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
    data: input.messages.map((message, ordinal) => ({
      sessionId: input.sessionId,
      ordinal,
      role: message.role,
      content: message.content,
      contentHash: digest(`${message.role}\n${message.hidden ? '1' : '0'}\n${message.content}`),
      hidden: Boolean(message.hidden),
      createdAt: parseTimestamp(message.createdAt),
    })),
    skipDuplicates: true,
  })

  const episodeRange = deriveEpisodeRange(messages, input.preserveTurns)
  if (!episodeRange) return

  const episodeMessages = input.messages.slice(episodeRange.startOrdinal, episodeRange.endOrdinal + 1)
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
      tokenEstimate: estimateContextMessages(asSourceMessages(episodeMessages)),
    },
    update: {
      summary: episodeSummary,
      searchText: `${episodeSummary}\n${episodeMessages.map(message => message.content).join('\n')}`.slice(0, 80_000),
      tokenEstimate: estimateContextMessages(asSourceMessages(episodeMessages)),
    },
  })

  const checkpoint = input.workingMemory || episodeSummary
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
