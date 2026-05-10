import { prisma } from '@/lib/prisma'

const STALE_PROCESSING_MS = 10 * 60 * 1000
const STALE_QUEUED_MS = 30 * 60 * 1000

export interface RagHealthEntry {
  id: string
  filename: string
  sourcePath: string | null
  kind: string | null
  size: number
  status: string
  ragMode: string | null
  embeddingModel: string | null
  errorMessage: string | null
  indexedAt: Date | null
  createdAt: Date
  chunkCount: number
  retrievalScope: 'full-document' | 'chunked'
  reason: string
}

export interface RagHealthSnapshot {
  summary: {
    total: number
    indexed: number
    pending: number
    failed: number
    warnings: number
    fullDocuments: number
    chunkedDocuments: number
    lastIndexedAt: string | null
  }
  indexedDocuments: RagHealthEntry[]
  pendingDocuments: RagHealthEntry[]
  failedDocuments: RagHealthEntry[]
}

function buildReason(entry: {
  status: string
  chunkCount: number
  retrievalScope: 'full-document' | 'chunked'
  errorMessage: string | null
}): string {
  if (entry.status === 'ready') {
    if (entry.errorMessage) {
      return `Indexed successfully with fallback: ${entry.errorMessage}`
    }

    if (entry.retrievalScope === 'full-document') {
      return 'Indexed as full-document context'
    }

    return `Indexed into ${entry.chunkCount} chunk${entry.chunkCount === 1 ? '' : 's'}`
  }

  if (entry.status === 'queued') {
    return 'Queued for background indexing'
  }

  if (entry.status === 'processing') {
    return 'Indexing in progress'
  }

  return entry.errorMessage || 'Indexing failed'
}

function toHealthEntry(document: {
  id: string
  filename: string
  sourcePath: string | null
  kind: string | null
  size: number
  status: string
  ragMode: string | null
  embeddingModel: string | null
  errorMessage: string | null
  indexedAt: Date | null
  createdAt: Date
  _count: { chunks: number }
}): RagHealthEntry {
  const chunkCount = document._count.chunks
  const retrievalScope = chunkCount === 1 ? 'full-document' : 'chunked'

  return {
    id: document.id,
    filename: document.filename,
    sourcePath: document.sourcePath,
    kind: document.kind,
    size: document.size,
    status: document.status,
    ragMode: document.ragMode,
    embeddingModel: document.embeddingModel,
    errorMessage: document.errorMessage,
    indexedAt: document.indexedAt,
    createdAt: document.createdAt,
    chunkCount,
    retrievalScope,
    reason: buildReason({
      status: document.status,
      chunkCount,
      retrievalScope,
      errorMessage: document.errorMessage,
    }),
  }
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export async function markStaleProcessingDocuments(userId: string) {
  const processingCutoff = new Date(Date.now() - STALE_PROCESSING_MS)
  const queuedCutoff = new Date(Date.now() - STALE_QUEUED_MS)
  const staleDocuments = await prisma.document.findMany({
    where: {
      userId,
      OR: [
        {
          status: 'processing',
          OR: [
            { indexedAt: { lt: processingCutoff } },
            { indexedAt: null, createdAt: { lt: processingCutoff } },
          ],
        },
        {
          status: 'queued',
          createdAt: { lt: queuedCutoff },
        },
      ],
    },
    select: { id: true, status: true },
  })

  if (staleDocuments.length === 0) return

  const ids = staleDocuments.map(doc => doc.id)
  await prisma.documentChunk.deleteMany({ where: { documentId: { in: ids } } })

  await prisma.document.updateMany({
    where: { id: { in: ids } },
    data: {
      status: 'error',
      errorMessage: 'Indexing timed out before it could finish. Check the embedding model in Settings, then delete this entry and upload the file again.',
      indexedAt: null,
    },
  })
}

export async function getRagHealthSnapshot(userId: string): Promise<RagHealthSnapshot> {
  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { chunks: true } } },
  })

  const entries = documents.map(toHealthEntry)
  const indexedDocuments = entries.filter(entry => entry.status === 'ready')
  const pendingDocuments = entries.filter(entry => entry.status === 'queued' || entry.status === 'processing')
  const failedDocuments = entries.filter(entry => entry.status === 'error')
  const warnings = indexedDocuments.filter(entry => Boolean(entry.errorMessage))
  const lastIndexedAt = indexedDocuments
    .map(entry => entry.indexedAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null

  return {
    summary: {
      total: entries.length,
      indexed: indexedDocuments.length,
      pending: pendingDocuments.length,
      failed: failedDocuments.length,
      warnings: warnings.length,
      fullDocuments: indexedDocuments.filter(entry => entry.retrievalScope === 'full-document').length,
      chunkedDocuments: indexedDocuments.filter(entry => entry.retrievalScope === 'chunked').length,
      lastIndexedAt: toIso(lastIndexedAt),
    },
    indexedDocuments,
    pendingDocuments,
    failedDocuments,
  }
}
