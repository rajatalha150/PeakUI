import { prisma } from '@/lib/prisma'

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

  if (entry.status === 'queued' || entry.status === 'staging') {
    return 'Queued for background indexing'
  }

  if (entry.status === 'processing' || entry.status === 'indexing') {
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

export async function getRagHealthSnapshot(userId: string): Promise<RagHealthSnapshot> {
  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { chunks: true } } },
  })

  const entries = documents.map(toHealthEntry)
  const indexedDocuments = entries.filter(entry => entry.status === 'ready')
  const pendingDocuments = entries.filter(entry => ['queued', 'staging', 'processing', 'indexing'].includes(entry.status))
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
