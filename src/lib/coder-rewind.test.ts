import { describe, expect, it } from 'vitest'
import { parseRewindResult, parseRewindSnapshots } from './coder-rewind'

describe('parseRewindSnapshots', () => {
  it('parses a valid snapshot list', () => {
    const parsed = parseRewindSnapshots({
      snapshots: [
        {
          promptId: 'sesh-1########0',
          turnIndex: 0,
          timestamp: '2026-09-21T10:00:00.000Z',
          diffStats: { filesChanged: 3, insertions: 12, deletions: 1 },
        },
        {
          promptId: 'sesh-1########1',
          turnIndex: 1,
          timestamp: '2026-09-21T10:05:00.000Z',
          diffStats: { filesChanged: 1, insertions: 0, deletions: 2 },
        },
      ],
    })
    expect(parsed).toEqual({
      snapshots: [
        {
          promptId: 'sesh-1########0',
          turnIndex: 0,
          timestamp: '2026-09-21T10:00:00.000Z',
          diffStats: { filesChanged: 3, insertions: 12, deletions: 1 },
        },
        {
          promptId: 'sesh-1########1',
          turnIndex: 1,
          timestamp: '2026-09-21T10:05:00.000Z',
          diffStats: { filesChanged: 1, insertions: 0, deletions: 2 },
        },
      ],
    })
  })

  it('parses an empty snapshot list', () => {
    expect(parseRewindSnapshots({ snapshots: [] })).toEqual({ snapshots: [] })
  })

  it('rejects a non-object payload', () => {
    expect(parseRewindSnapshots(null)).toHaveProperty('error')
    expect(parseRewindSnapshots('nope')).toHaveProperty('error')
    expect(parseRewindSnapshots([])).toHaveProperty('error')
    expect(parseRewindSnapshots({})).toHaveProperty('error')
  })

  it('rejects a snapshot missing its rewind target or turn index', () => {
    expect(
      parseRewindSnapshots({ snapshots: [{ turnIndex: 0, timestamp: 'x', diffStats: {} }] }),
    ).toHaveProperty('error')
    expect(
      parseRewindSnapshots({ snapshots: [{ promptId: '', turnIndex: 0, timestamp: 'x', diffStats: {} }] }),
    ).toHaveProperty('error')
    expect(
      parseRewindSnapshots({ snapshots: [{ promptId: 'p', turnIndex: -1, timestamp: 'x', diffStats: {} }] }),
    ).toHaveProperty('error')
  })

  it('coerces a missing diff-stat field to zero', () => {
    const parsed = parseRewindSnapshots({
      snapshots: [{ promptId: 'p', turnIndex: 0, timestamp: 'x', diffStats: {} }],
    })
    expect(parsed).toEqual({
      snapshots: [
        {
          promptId: 'p',
          turnIndex: 0,
          timestamp: 'x',
          diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
        },
      ],
    })
  })
})

describe('parseRewindResult', () => {
  it('parses a successful rewind', () => {
    const parsed = parseRewindResult({
      rewound: true,
      targetTurnIndex: 1,
      filesChanged: ['/workspace/a.ts', '/workspace/b.ts'],
      filesFailed: [],
    })
    expect(parsed).toEqual({
      result: {
        rewound: true,
        targetTurnIndex: 1,
        filesChanged: ['/workspace/a.ts', '/workspace/b.ts'],
        filesFailed: [],
      },
    })
  })

  it('parses a partial rewind with failed files', () => {
    const parsed = parseRewindResult({
      rewound: false,
      targetTurnIndex: 0,
      filesChanged: ['/workspace/a.ts'],
      filesFailed: ['/workspace/c.ts'],
    })
    expect(parsed).toHaveProperty('result.rewound', false)
    expect(parsed).toHaveProperty('result.filesFailed', ['/workspace/c.ts'])
  })

  it('rejects a malformed result', () => {
    expect(parseRewindResult(null)).toHaveProperty('error')
    expect(parseRewindResult({ rewound: true })).toHaveProperty('error')
    expect(parseRewindResult({ rewound: true, targetTurnIndex: 0 })).toHaveProperty('error')
    expect(parseRewindResult({ rewound: 'yes', targetTurnIndex: 0, filesChanged: [], filesFailed: [] })).toHaveProperty('error')
    expect(parseRewindResult({ rewound: true, targetTurnIndex: 0, filesChanged: [1], filesFailed: [] })).toHaveProperty('error')
  })
})
