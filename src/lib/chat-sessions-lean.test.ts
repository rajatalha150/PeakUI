import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the prisma singleton so listChatSessions / getChatSessionById can be
// exercised without a live database. Only chatSession.findMany / findUnique
// are touched by these two functions. vi.hoisted runs before the hoisted
// vi.mock factory so the fns are initialized in time.
const { findMany, findUnique, create, userSettingsFindUnique } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  userSettingsFindUnique: vi.fn(),
}))
vi.mock('./prisma', () => ({
  prisma: {
    chatSession: { findMany, findUnique, create },
    userSettings: { findUnique: userSettingsFindUnique },
  },
}))

import { listChatSessions, getChatSessionById, upsertChatSession } from './chat-sessions'

const baseRow = {
  userId: 'user-1',
  title: 'Session',
  pinned: false,
  surface: 'openclaw',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  folderId: null,
  summary: null,
  contextSummary: null,
  contextSummaryUpdatedAt: null,
  analyticsJson: '{}',
  parentSessionId: null,
  branchFromMessageId: null,
  branchLabel: null,
  autoContinueMode: 'manual',
  autoContinueMaxSteps: 3,
  lastAutoContinueAt: null,
  ragEnabled: false,
  ragQuery: null,
  ragSourcesJson: null,
  tags: [],
  _count: { childSessions: 0 },
}

describe('listChatSessions lean projection', () => {
  beforeEach(() => {
    findMany.mockReset()
    findUnique.mockReset()
    create.mockReset()
    userSettingsFindUnique.mockReset()
  })

  it('projects out the heavy messages column from the list query', async () => {
    findMany.mockResolvedValue([{ ...baseRow, id: 's1' }])

    await listChatSessions('user-1', 'openclaw')

    expect(findMany).toHaveBeenCalledTimes(1)
    const select = findMany.mock.calls[0][0].select
    // The transcript column must NOT be selected for the sidebar list.
    expect(select.messages).toBeUndefined()
    // Small/capped columns are kept so sidebar features (analytics pill,
    // working-memory status, summary) still render without a detail fetch.
    expect(select.analyticsJson).toBe(true)
    expect(select.contextSummary).toBe(true)
    expect(select.ragSourcesJson).toBe(true)
    expect(select.summary).toBe(true)
  })

  it('returns lean rows with empty messages placeholders (no transcript parsing)', async () => {
    findMany.mockResolvedValue([{ ...baseRow, id: 's1', title: 'Alpha' }])

    const result = await listChatSessions('user-1', 'openclaw')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
    expect(result[0].title).toBe('Alpha')
    // No messages column was fetched, so the DTO exposes an empty array
    // (same shape as before, just without the transcript payload).
    expect(result[0].messages).toEqual([])
    // Analytics still parsed from the small JSON column.
    expect(result[0].analytics).not.toBeNull()
  })

  it('getChatSessionById returns the full transcript (messages parsed)', async () => {
    findUnique.mockResolvedValue({
      ...baseRow,
      id: 's2',
      userId: 'user-1',
      messages: JSON.stringify([
        { role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    })

    const result = await getChatSessionById('user-1', 's2')

    expect(findUnique).toHaveBeenCalledTimes(1)
    // getChatSessionById uses include (full row), so messages are parsed.
    expect(result?.messages).toHaveLength(1)
    expect(result?.messages[0]?.content).toBe('hello')
  })

  it('getChatSessionById returns null when the session belongs to another user', async () => {
    findUnique.mockResolvedValue({ ...baseRow, id: 's3', userId: 'other-user' })

    const result = await getChatSessionById('user-1', 's3')

    expect(result).toBeNull()
  })
})

describe('upsertChatSession write path', () => {
  beforeEach(() => {
    findMany.mockReset()
    findUnique.mockReset()
    create.mockReset()
    userSettingsFindUnique.mockReset()
  })

  it('returns the in-memory messages without a redundant DB re-read / re-parse on create', async () => {
    // getUserSettings falls back to DEFAULT_SETTINGS when no row exists.
    userSettingsFindUnique.mockResolvedValue(null)
    const inputMessages = [
      { role: 'user', content: 'hello world', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    create.mockResolvedValue({
      ...baseRow,
      id: 's4',
      userId: 'user-1',
      // Server row stores a serialized transcript we should NOT need to re-read.
      messages: JSON.stringify(inputMessages),
    })

    const result = await upsertChatSession('user-1', {
      surface: 'openclaw',
      messages: inputMessages,
    })

    expect(result.created).toBe(true)
    // The returned DTO carries the normalized in-memory messages directly,
    // proving the messagesOverride path (no re-parse of the stored string).
    expect(result.session.id).toBe('s4')
    expect(result.session.messages).toHaveLength(1)
    expect(result.session.messages[0]?.content).toBe('hello world')
    // Exactly one DB write; no follow-up findUnique to reload the row.
    expect(create).toHaveBeenCalledTimes(1)
    expect(findUnique).not.toHaveBeenCalled()
  })
})