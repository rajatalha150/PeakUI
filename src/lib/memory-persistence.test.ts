import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let temporary: string
let memory: typeof import('./memory')
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'peakui-memory-test-'))
  vi.stubEnv('PEAKUI_DATA_DIR', temporary)
  vi.resetModules()
  memory = await import('./memory')
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(temporary, { recursive: true, force: true })
})

const summary = (id: string) => ({
  sessionId: id, title: `Session ${id}`, objective: 'Audit memory', outcome: `Outcome ${id}`,
  keyFindings: ['Reliable persistence'], nextSteps: [], createdAt: '2026-09-13T12:00:00.000Z',
})

describe('memory persistence', () => {
  it('preserves every session under concurrent daily updates', async () => {
    await Promise.all(Array.from({ length: 16 }, (_, index) => memory.appendToDailyMemoryForUser('alice', '2026-09-13', {
      sessionId: `session-${index}`, title: `Task ${index}`, mode: 'workspace-tool', summary: `Result ${index}`, timestamp: summary('').createdAt,
    })))
    const daily = await memory.loadDailyMemoryForUser('alice', '2026-09-13')
    expect(daily?.sessions).toHaveLength(16)
    expect(new Set(daily?.sessions.map(session => session.sessionId)).size).toBe(16)
    await memory.appendToDailyMemoryForUser('alice', '2026-09-13', {
      sessionId: 'session-8', title: 'Updated', mode: 'workspace-tool', summary: 'New result', timestamp: summary('').createdAt,
    })
    expect((await memory.loadDailyMemoryForUser('alice', '2026-09-13'))?.sessions).toHaveLength(16)
  })

  it('replaces only the matching summary, without deleting preceding entries', async () => {
    await Promise.all(['a', 'b', 'c'].map(id => memory.saveSessionSummaryForUser('bob', summary(id))))
    await memory.saveSessionSummaryForUser('bob', { ...summary('b'), outcome: 'Updated b' })
    const content = await readFile(join(memory.getUserMemoryDir('bob'), 'session-summaries.md'), 'utf8')
    for (const id of ['a', 'b', 'c']) expect(content.split(`**Session ID:** ${id}`)).toHaveLength(2)
    expect(content).toContain('Outcome a')
    expect(content).toContain('Updated b')
    expect(content).toContain('Outcome c')
    expect(await readdir(memory.getUserMemoryDir('bob'))).toEqual(['session-summaries.md'])
  })

  it('does not read another user’s files or allow a date path escape', async () => {
    expect(await memory.loadDailyMemoryForUser('charlie', '2026-09-13')).toBeNull()
    await expect(memory.loadDailyMemoryForUser('alice', '../MEMORY')).rejects.toThrow('Invalid memory date')
    expect(() => memory.getUserMemoryDir('../alice')).toThrow('Invalid memory user id')
  })
})
