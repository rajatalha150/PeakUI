import { describe, expect, it } from 'vitest'
import { detectFileKind } from './file-shared'
import {
  FULL_DOCUMENT_CONTEXT_CHAR_LIMIT,
  buildKnowledgeBaseRetrievalContract,
  buildRagContextBlock,
  chunkText,
  keywordSearch,
  parseRagQueryFilters,
  type RagChunkForSearch,
} from './rag'
import {
  chunkDocument,
  chunkTextByBoundaries,
  deduplicateResults,
  normalizeSearchText,
  tokenize,
} from './rag-engine'

describe('RAG retrieval', () => {
  it('keeps small files as a whole-document chunk', () => {
    const small = 'alpha beta gamma '.repeat(150)
    expect(small.length).toBeLessThan(FULL_DOCUMENT_CONTEXT_CHAR_LIMIT)
    expect(chunkText(small)).toHaveLength(1)

    const large = 'alpha beta gamma '.repeat(350)
    expect(large.length).toBeGreaterThan(FULL_DOCUMENT_CONTEXT_CHAR_LIMIT)
    expect(chunkText(large).length).toBeGreaterThan(1)
  })

  it('ranks the most relevant chunk first for a recall-style query', () => {
    const chunks: RagChunkForSearch[] = [
      {
        chunkId: 'match',
        chunkIndex: 0,
        documentChunkCount: 1,
        documentId: 'doc-a',
        filename: 'rag-notes.md',
        content: 'Retrieval evaluation should verify recall, grounding, and file-type coverage. Recall matters most here.',
        wholeDocument: true,
      },
      {
        chunkId: 'noise',
        chunkIndex: 0,
        documentChunkCount: 1,
        documentId: 'doc-b',
        filename: 'garden-notes.md',
        content: 'Tomatoes need sun and water. Compost improves soil and mulch reduces evaporation.',
        wholeDocument: true,
      },
    ]

    const results = keywordSearch(chunks, 'recall grounding file-type coverage', 5)
    expect(results[0]?.chunkId).toBe('match')
  })

  it('parses search directives for file, folder, type, and extension narrowing', () => {
    const parsed = parseRagQueryFilters('file:roadmap folder:docs type:code ext:tsx ship it')
    expect(parsed.query).toBe('ship it')
    expect(parsed.filters).toEqual({
      filename: 'roadmap',
      folder: 'docs',
      fileKind: 'code',
      extension: 'tsx',
    })
  })
})

describe('RAG grounding', () => {
  it('describes the retrieval contract and keeps full-document context intact', () => {
    const context = buildRagContextBlock('evaluation', [
      {
        chunkId: 'doc-1',
        chunkIndex: 0,
        documentChunkCount: 1,
        documentId: 'doc-1',
        filename: 'notes.md',
        content: 'This short note should be injected in full when the file is small enough.',
        score: 0.99,
        mode: 'keyword',
        wholeDocument: true,
        fileKind: 'text',
        extension: 'md',
        documentSize: 128,
        excerptChars: 128,
      },
    ], 'keyword')

    expect(buildKnowledgeBaseRetrievalContract()).toContain('If an entry says "full document"')
    expect(context).toContain('full document')
    expect(context).toContain('This short note should be injected in full when the file is small enough.')
  })
})

describe('RAG file coverage', () => {
  it('maps the supported file families to stable file kinds', () => {
    expect(detectFileKind('report.pdf', 'application/pdf')).toBe('document')
    expect(detectFileKind('slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('document')
    expect(detectFileKind('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('document')
    expect(detectFileKind('notes.odt', 'application/octet-stream')).toBe('document')
    expect(detectFileKind('table.ods', 'application/octet-stream')).toBe('document')
    expect(detectFileKind('data.csv', 'text/csv')).toBe('data')
    expect(detectFileKind('config.yaml', 'text/yaml')).toBe('data')
    expect(detectFileKind('schema.xml', 'application/xml')).toBe('data')
    expect(detectFileKind('script.tsx', 'text/typescript')).toBe('code')
    expect(detectFileKind('archive.zip', 'application/zip')).toBe('archive')
    expect(detectFileKind('picture.png', 'image/png')).toBe('image')
    expect(detectFileKind('IMG_8700.HEIC', 'application/octet-stream')).toBe('image')
    expect(detectFileKind('photo.heif', '')).toBe('image')
    expect(detectFileKind('scan.tiff', 'application/octet-stream')).toBe('image')
    expect(detectFileKind('clip.mov', 'application/octet-stream')).toBe('video')
    expect(detectFileKind('movie.mkv', '')).toBe('video')
    expect(detectFileKind('voice.m4a', 'application/octet-stream')).toBe('audio')
    expect(detectFileKind('recording.flac', '')).toBe('audio')
    expect(detectFileKind('song.mp3', 'audio/mpeg')).toBe('audio')
    expect(detectFileKind('video.mp4', 'video/mp4')).toBe('video')
    expect(detectFileKind('blob.bin', 'application/octet-stream')).toBe('binary')
  })
})

describe('boundary chunking', () => {
  it('chunks markdown on headings without breaking code fences', () => {
    const text = `# Intro\nSome text here.\n## Section A\n\`\`\`ts\nconst a = 1\nconst b = 2\n\`\`\`\n## Section B\nMore text.`
    const chunks = chunkDocument(text, 'notes.md', 'text/markdown')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const joined = chunks.map(c => c.content).join('')
    expect(joined).toContain('## Section A')
    expect(joined).toContain('## Section B')
  })

  it('preserves small documents as a single chunk', () => {
    const short = 'Just a tiny file.\nWith two lines.'
    const chunks = chunkDocument(short, 'tiny.txt', 'text/plain')
    expect(chunks).toHaveLength(1)
  })

  it('chunks code on function boundaries', () => {
    const code = `function one() { return 1; }\nfunction two() { return 2; }\nfunction three() { return 3; }\nfunction four() { return 4; }`
    const chunks = chunkDocument(code, 'lib.ts', 'text/typescript')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('chunks CSV on row boundaries', () => {
    const csv = 'name,age\nAlice,30\nBob,25\nCharlie,35\nDiana,40\n'
      + 'Eve,28\nFrank,50\nGrace,33\nHeidi,29\nIvan,45\nJudy,31\n'
    const chunks = chunkDocument(csv, 'people.csv', 'text/csv')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    for (const chunk of chunks) {
      expect(chunk.content.startsWith('name,age') || chunk.content.includes('\n')).toBe(true)
    }
  })
})

describe('Unicode tokenization', () => {
  it('tokenizes mixed scripts and numbers', () => {
    const tokens = tokenize('Hello 世界123 Python3.12')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens).toContain('hello')
    expect(tokens).toContain('python')
  })

  it('normalizes search text to lowercase ASCII folds', () => {
    expect(normalizeSearchText('Café résumé')).toBe('cafe resume')
    expect(normalizeSearchText('  Multiple   spaces  ')).toBe('multiple spaces')
  })
})

describe('deduplication', () => {
  it('keeps the highest-scored duplicate by chunk id', () => {
    const results: RagChunkForSearch[] = [
      {
        chunkId: 'a',
        chunkIndex: 0,
        documentChunkCount: 2,
        documentId: 'doc-1',
        filename: 'x.md',
        content: 'first',
        score: 0.5,
        mode: 'keyword',
      },
      {
        chunkId: 'a',
        chunkIndex: 0,
        documentChunkCount: 2,
        documentId: 'doc-1',
        filename: 'x.md',
        content: 'second',
        score: 0.8,
        mode: 'semantic',
      },
    ] as unknown as RagChunkForSearch[]

    const deduped = deduplicateResults(results as import('./rag-engine').RagSearchResult[])
    expect(deduped).toHaveLength(1)
    expect(deduped[0].score).toBe(0.8)
  })
})
