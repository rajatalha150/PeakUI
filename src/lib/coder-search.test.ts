import { describe, expect, it } from 'vitest'
import { absoluteWorkspacePath, parseGlobResult, searchLines } from './coder-search'

describe('parseGlobResult', () => {
  it('parses a glob response', () => {
    expect(parseGlobResult({ kind: 'glob', pattern: '**', cwd: '', matches: ['a.ts', 'src/b.ts'], count: 2, truncated: false })).toEqual({
      result: { matches: ['a.ts', 'src/b.ts'], count: 2, truncated: false },
    })
  })

  it('rejects a malformed glob response', () => {
    expect(parseGlobResult(null)).toHaveProperty('error')
    expect(parseGlobResult({})).toHaveProperty('error')
    expect(parseGlobResult({ matches: [1] })).toHaveProperty('error')
  })
})

describe('searchLines', () => {
  it('returns 1-based line numbers and trimmed snippets, case-insensitive', () => {
    expect(searchLines('hello\nWORLD\nhello world\n', 'world')).toEqual([
      { line: 2, text: 'WORLD' },
      { line: 3, text: 'hello world' },
    ])
  })

  it('returns nothing for an empty query or no match', () => {
    expect(searchLines('abc\ndef\n', '')).toEqual([])
    expect(searchLines('abc\ndef\n', 'xyz')).toEqual([])
  })

  it('bounds results to the limit', () => {
    const content = Array.from({ length: 100 }, (_, i) => `line ${i} match`).join('\n')
    expect(searchLines(content, 'match', 3)).toHaveLength(3)
  })
})

describe('absoluteWorkspacePath', () => {
  it('joins a workspace root and a relative match', () => {
    expect(absoluteWorkspacePath('/workspace', 'src/a.ts')).toBe('/workspace/src/a.ts')
    expect(absoluteWorkspacePath('/workspace/', './a.ts')).toBe('/workspace/a.ts')
  })

  it('skips the glob root entry', () => {
    expect(absoluteWorkspacePath('/workspace', '.')).toBeNull()
    expect(absoluteWorkspacePath('/workspace', './')).toBeNull()
    expect(absoluteWorkspacePath('/workspace', '')).toBeNull()
  })
})
