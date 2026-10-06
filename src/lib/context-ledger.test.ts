import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  eventCreateMany: vi.fn(),
  episodeFindFirst: vi.fn(),
  episodeFindMany: vi.fn(),
  episodeUpsert: vi.fn(),
  snapshotFindFirst: vi.fn(),
  snapshotCreate: vi.fn(),
}))

vi.mock('./prisma', () => ({
  prisma: {
    contextEvent: { createMany: db.eventCreateMany },
    contextEpisode: { findFirst: db.episodeFindFirst, findMany: db.episodeFindMany, upsert: db.episodeUpsert },
    contextSnapshot: { findFirst: db.snapshotFindFirst, create: db.snapshotCreate },
  },
}))

import { CODER_RECALL_NOTE_PREFIX, recallContextEpisodes, recordContextLedger } from './context-ledger'

beforeEach(() => {
  for (const mock of Object.values(db)) mock.mockReset()
  db.episodeFindFirst.mockResolvedValue({ endOrdinal: 1 })
  db.episodeUpsert.mockResolvedValue({ id: 'episode-2' })
  db.snapshotFindFirst.mockResolvedValue(null)
})

describe('Coder context ledger', () => {
  it('adds only newly completed turns and excludes old injected notes from memory', async () => {
    const synthetic = `${CODER_RECALL_NOTE_PREFIX}\n[Context episode old] clone notes Continue the Android build`
    await recordContextLedger({
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: 'Clone repository' },
        { role: 'assistant', content: 'Cloned.' },
        { role: 'user', content: synthetic },
        { role: 'assistant', content: 'Android SDK is installed.' },
        { role: 'user', content: 'Build the APK.' },
      ],
      workingMemory: 'Android build in progress',
      profile: { provider: 'coder-daemon', model: 'test', contextWindow: 8192 },
      preserveTurns: 1,
    })

    const upsert = db.episodeUpsert.mock.calls[0][0]
    expect(upsert.create).toMatchObject({ startOrdinal: 2, endOrdinal: 3 })
    expect(upsert.create.searchText).not.toContain(CODER_RECALL_NOTE_PREFIX)
    expect(db.eventCreateMany.mock.calls[0][0].data[2].content).toBe(synthetic)
  })

  it('does not create an overlapping episode when no new turn is complete', async () => {
    db.episodeFindFirst.mockResolvedValue({ endOrdinal: 3 })
    await recordContextLedger({
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: 'One' }, { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'Two' }, { role: 'assistant', content: 'Done' },
        { role: 'user', content: 'Current' },
      ],
      workingMemory: null,
      profile: { provider: 'coder-daemon', model: 'test', contextWindow: 8192 },
      preserveTurns: 1,
    })
    expect(db.episodeUpsert).not.toHaveBeenCalled()
  })

  it('recalls distinct history ranges instead of multiple overlapping copies', async () => {
    db.episodeFindMany.mockResolvedValue([
      { id: 'old-1', startOrdinal: 0, endOrdinal: 1, summary: 'Clone and build', searchText: 'clone build' },
      { id: 'old-2', startOrdinal: 0, endOrdinal: 9, summary: 'Clone and build more', searchText: 'clone build' },
      { id: 'new', startOrdinal: 10, endOrdinal: 13, summary: 'Build APK', searchText: 'build apk' },
    ])
    const result = await recallContextEpisodes('session-1', 'build')
    expect(result.episodeIds).toEqual(['new', 'old-2'])
    expect(result.content).not.toContain('old-1')
  })
})
