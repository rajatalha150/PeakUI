import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(),
  getEmbeddings: vi.fn(),
}))
vi.mock('./prisma', () => ({ prisma: {
  documentChunk: { deleteMany: mocks.deleteMany, createMany: mocks.createMany },
  document: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
} }))
vi.mock('./rag', () => ({ getEmbeddings: mocks.getEmbeddings }))
vi.mock('./rag-engine', () => ({
  isPgvectorEnabled: () => Promise.resolve(false),
  normalizeVectorDimensions: (value: number[]) => value,
  vectorToPgLiteral: (value: number[]) => JSON.stringify(value),
}))

import { indexWorkbookChunks } from './rag-workbook-index'

const settings = { ragModel: 'test-embed', ragMode: 'semantic' as const, ollamaHost: 'http://localhost', ollamaApiKey: '' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue({ status: 'processing', contentHash: 'hash' })
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.getEmbeddings.mockImplementation(async (values: string[]) => values.map(() => [0.1, 0.2]))
})

describe('workbook embedding completion', () => {
  async function withWorkbook(run: (path: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'peakui-embed-'))
    const path = join(dir, 'rows.xlsx')
    try {
      const book = new ExcelJS.Workbook()
      const sheet = book.addWorksheet('All rows')
      for (let row = 1; row <= 60; row++) sheet.getCell(`A${row}`).value = `record-${row} ${'content '.repeat(55)}`
      await book.xlsx.writeFile(path)
      await run(path)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('embeds every stored chunk before marking the document ready', async () => withWorkbook(async path => {
    const result = await indexWorkbookChunks('document-id', 'hash', path, settings)
    const stored = mocks.createMany.mock.calls.flatMap(call => call[0].data)
    const embedded = mocks.getEmbeddings.mock.calls.reduce((sum, call) => sum + call[0].length, 0)
    expect(result.chunkCount).toBeGreaterThan(12)
    expect(stored).toHaveLength(result.chunkCount)
    expect(embedded).toBe(result.chunkCount)
    expect(stored.every(row => row.embedding)).toBe(true)
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ready' }) }))
  }))

  it('does not mark a partially embedded workbook ready', async () => withWorkbook(async path => {
    mocks.getEmbeddings.mockRejectedValueOnce(new Error('model unavailable'))
    await expect(indexWorkbookChunks('document-id', 'hash', path, settings)).rejects.toThrow('model unavailable')
    expect(mocks.updateMany).not.toHaveBeenCalled()
  }))
})
