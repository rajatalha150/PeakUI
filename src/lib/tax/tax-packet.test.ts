import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { document: { findMany: mocks.findMany } } }))

import { buildTaxReturnDraft, loadTaxPacketChunks } from './tax-packet'

beforeEach(() => mocks.findMany.mockReset())

describe('loadTaxPacketChunks', () => {
  it('never reads all documents when a client folder is absent', async () => {
    expect(await loadTaxPacketChunks({ userId: 'user-1', folder: null })).toEqual([])
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('uses a strict folder prefix and excludes another client even if the database returns it', async () => {
    const doc = (id: string, sourcePath: string) => ({
      id, filename: 'w2.txt', sourcePath, chunks: [{ id: `chunk-${id}`, chunkIndex: 0, content: `W-2 for ${id}` }],
    })
    mocks.findMany.mockResolvedValue([
      doc('a', 'client-a/2025/w2.txt'),
      doc('b', 'client-a-old/2025/w2.txt'),
      doc('c', 'client-b/2025/w2.txt'),
      doc('d', 'client-a/2025/subfolder/w2.txt'),
    ])
    const chunks = await loadTaxPacketChunks({ userId: 'user-1', folder: '/client-a/2025/' })
    expect(chunks.map(chunk => chunk.documentId)).toEqual(['a', 'd'])
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-1', status: 'ready',
        OR: [
          { sourcePath: 'client-a/2025' },
          { sourcePath: { startsWith: 'client-a/2025/' } },
        ],
      },
    }))
  })

  it('does not promote an unlabeled identifier into the taxpayer SSN', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 'doc-1', filename: 'notes.txt', sourcePath: 'client-a/2025/notes.txt',
      chunks: [{ id: 'chunk-1', chunkIndex: 0, content: 'Reference ID 123-45-6789. Taxpayer name: Jane Doe.' }],
    }])
    const draft = await buildTaxReturnDraft({ userId: 'user-1', folder: 'client-a/2025', taxYear: '2025' })
    expect(draft.taxpayer.ssn).toBeUndefined()
    expect(draft.missingFields).toContain('taxpayer.ssn')
  })
})
