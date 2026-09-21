import { describe, expect, it } from 'vitest'
import { parseFileContent, parseFileList, parseFileWriteResult } from './coder-files'

describe('parseFileList', () => {
  it('parses a directory listing', () => {
    const parsed = parseFileList({
      kind: 'list',
      path: '.',
      entries: [
        { name: 'QWEN.md', kind: 'file', ignored: false },
        { name: 'src', kind: 'directory', ignored: false },
      ],
      truncated: false,
      matchedIgnore: null,
    })
    expect(parsed).toEqual({
      list: {
        path: '.',
        entries: [
          { name: 'QWEN.md', kind: 'file', ignored: false },
          { name: 'src', kind: 'directory', ignored: false },
        ],
        truncated: false,
      },
    })
  })

  it('parses an empty listing', () => {
    expect(parseFileList({ kind: 'list', path: '.', entries: [], truncated: false })).toEqual({
      list: { path: '.', entries: [], truncated: false },
    })
  })

  it('rejects a malformed listing', () => {
    expect(parseFileList(null)).toHaveProperty('error')
    expect(parseFileList({})).toHaveProperty('error')
    expect(parseFileList({ entries: [{ name: 'x' }] })).toHaveProperty('error') // missing kind
    expect(parseFileList({ entries: [{ kind: 'file' }] })).toHaveProperty('error') // missing name
  })
})

describe('parseFileContent', () => {
  it('parses a full file read with a hash', () => {
    const parsed = parseFileContent({
      kind: 'file',
      path: 'src/a.ts',
      content: 'export const a = 1\n',
      encoding: 'utf-8',
      bom: false,
      lineEnding: '\n',
      sizeBytes: 20,
      returnedBytes: 20,
      truncated: false,
      hash: 'abc123',
      matchedIgnore: null,
      originalLineCount: 1,
      nextCursor: null,
      hasMore: false,
    })
    expect(parsed).toEqual({
      file: { content: 'export const a = 1\n', hash: 'abc123', sizeBytes: 20, truncated: false },
    })
  })

  it('treats a missing hash as null (truncated read)', () => {
    const parsed = parseFileContent({ kind: 'file', content: 'x', truncated: true })
    expect(parsed).toEqual({ file: { content: 'x', hash: null, sizeBytes: 1, truncated: true } })
  })

  it('rejects a read missing content', () => {
    expect(parseFileContent(null)).toHaveProperty('error')
    expect(parseFileContent({ kind: 'file' })).toHaveProperty('error')
  })
})

describe('parseFileWriteResult', () => {
  it('parses a write result', () => {
    expect(
      parseFileWriteResult({ kind: 'file_write', path: 'src/a.ts', mode: 'replace', created: false, sizeBytes: 21, hash: 'def456' }),
    ).toEqual({ result: { created: false, hash: 'def456', sizeBytes: 21 } })
  })

  it('rejects a write result missing the new hash', () => {
    expect(parseFileWriteResult(null)).toHaveProperty('error')
    expect(parseFileWriteResult({ kind: 'file_write' })).toHaveProperty('error')
  })
})
