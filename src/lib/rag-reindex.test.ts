import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn() }))
vi.mock('./prisma', () => ({ prisma: { document: mocks } }))
vi.mock('./rag-engine', () => ({ indexDocumentChunks: vi.fn() }))
import { reindexDocumentsIfModelChanged } from './rag-queue'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.findMany.mockResolvedValue([
    { id: 'one', filename: 'statement.pdf', ragMode: 'semantic', embeddingModel: 'old-model' },
  ])
  mocks.update.mockResolvedValue({})
})

it('puts model-change reindex requests in the durable worker queue', async () => {
  const result = await reindexDocumentsIfModelChanged('user', 'new-model', {
    ragMode: 'semantic', ollamaHost: 'http://localhost:11434', ollamaApiKey: '',
  })
  expect(result.triggered).toBe(1)
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: 'one' },
    data: { status: 'queued', indexingAttempts: 0, errorMessage: null },
  })
})
