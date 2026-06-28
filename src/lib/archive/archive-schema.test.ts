import { describe, expect, it } from 'vitest'
import { normalizeArchiveDocumentInput, archiveDocumentHasRenderableContent } from './archive-schema'

describe('normalizeArchiveDocumentInput', () => {
  it('accepts files as alias for entries at the top level', () => {
    const result = normalizeArchiveDocumentInput({
      title: 'Bundle',
      files: [
        { name: 'a.md', content: '# a' },
        { name: 'b.txt', content: 'hello' },
      ],
    } as never)

    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].name).toBe('a.md')
    expect(archiveDocumentHasRenderableContent(result)).toBe(true)
  })

  it('accepts data, body, text as aliases for entry content', () => {
    const result = normalizeArchiveDocumentInput({
      title: 'Bundle',
      entries: [
        { name: 'a', data: 'from data' },
        { name: 'b', body: 'from body' },
        { name: 'c', text: 'from text' },
      ],
    } as never)

    expect(result.entries.map(e => e.content)).toEqual(['from data', 'from body', 'from text'])
  })

  it('accepts filename, path, file as aliases for entry name', () => {
    const result = normalizeArchiveDocumentInput({
      title: 'Bundle',
      entries: [
        { filename: 'a.md', content: '# a' },
        { path: 'b.txt', content: 'hello' },
        { file: 'c.json', content: '{}' },
      ],
    } as never)

    expect(result.entries.map(e => e.name)).toEqual(['a.md', 'b.txt', 'c.json'])
  })

  it('drops entries missing both name and content aliases', () => {
    const result = normalizeArchiveDocumentInput({
      title: 'Bundle',
      entries: [
        { name: 'ok', content: 'yes' },
        { name: 'no-content' },
        { content: 'no-name' },
      ],
    } as never)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe('ok')
  })
})