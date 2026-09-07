import { describe, expect, it } from 'vitest'
import { buildMemoryContext } from './memory'
import type { DailyMemory } from './memory'

describe('memory isolation — buildMemoryContext excludes the current session', () => {
  const memories: DailyMemory[] = [
    {
      date: '2026-09-07',
      sessions: [
        { sessionId: 'session-A', title: 'Tax prep', mode: 'workspace-tool', summary: 'Prepared 1040 for client', timestamp: '' },
        { sessionId: 'session-B', title: 'Cat image', mode: 'workspace-tool', summary: 'Generated cat image', timestamp: '' },
      ],
      keyFindings: ['SD-Turbo works'],
      decisions: [],
      openQuestions: [],
    },
  ]

  it('includes other sessions but excludes the current one', () => {
    const context = buildMemoryContext(memories, { currentSessionId: 'session-B' })
    expect(context).toContain('Tax prep')
    expect(context).not.toContain('Cat image')
  })

  it('returns empty when the only session is the current one', () => {
    const only: DailyMemory[] = [
      { date: '2026-09-07', sessions: [{ sessionId: 'session-B', title: 'Cat image', mode: 'x', summary: 's', timestamp: '' }], keyFindings: [], decisions: [], openQuestions: [] },
    ]
    expect(buildMemoryContext(only, { currentSessionId: 'session-B' })).toBe('')
  })

  it('includes everything when no current session is given', () => {
    const context = buildMemoryContext(memories)
    expect(context).toContain('Tax prep')
    expect(context).toContain('Cat image')
  })
})
