import { indexDocumentChunks, type IndexDocumentResult } from './rag-engine'
import { prisma } from './prisma'
import { isSameOllamaModel } from './embedding-models'

export type RagJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RagIndexJob {
  jobId: string
  documentId: string
  status: RagJobStatus
  progress: number
  attempts: number
  maxAttempts: number
  error?: string
  createdAt: Date
  updatedAt: Date | null
}

interface PendingJob {
  jobId: string
  documentId: string
  text: string
  filename: string
  mimeType: string
  settings: { ragModel: string; ragMode: 'semantic' | 'keyword'; ollamaHost: string; ollamaApiKey: string }
  attempts: number
  maxAttempts: number
  resolve: (result: IndexDocumentResult) => void
  reject: (error: Error) => void
}

const MAX_CONCURRENT = 2
const pendingQueue: PendingJob[] = []
const activeJobs = new Map<string, PendingJob>()
const cancelledJobs = new Set<string>()
let queueRunning = false

function generateJobId(): string {
  return `ragjob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export async function enqueueDocumentIndexing(
  documentId: string,
  text: string,
  filename: string,
  mimeType: string,
  settings: { ragModel: string; ragMode: 'semantic' | 'keyword'; ollamaHost: string; ollamaApiKey: string },
): Promise<IndexDocumentResult> {
  const jobId = generateJobId()
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'indexing', indexingJobId: jobId, errorMessage: null },
  })

  return new Promise((resolve, reject) => {
    pendingQueue.push({
      jobId,
      documentId,
      text,
      filename,
      mimeType,
      settings,
      attempts: 0,
      maxAttempts: 3,
      resolve,
      reject,
    })
    startQueue()
  })
}

export function cancelIndexingJob(jobId: string): boolean {
  const pendingIndex = pendingQueue.findIndex(job => job.jobId === jobId)
  if (pendingIndex >= 0) {
    const job = pendingQueue[pendingIndex]
    cancelledJobs.add(jobId)
    pendingQueue.splice(pendingIndex, 1)
    job.reject(new Error('Indexing job cancelled by user'))
    return true
  }

  const activeJob = activeJobs.get(jobId)
  if (activeJob) {
    cancelledJobs.add(jobId)
    return true
  }

  return false
}

export async function getIndexingJob(jobId: string): Promise<RagIndexJob | null> {
  const doc = await prisma.document.findUnique({ where: { indexingJobId: jobId } })
  if (!doc || !doc.indexingJobId) return null

  return {
    jobId: doc.indexingJobId,
    documentId: doc.id,
    status: doc.status as RagJobStatus,
    progress: doc.indexingProgress ?? 0,
    attempts: doc.indexingAttempts ?? 0,
    maxAttempts: 3,
    error: doc.errorMessage ?? undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? doc.createdAt,
  }
}

function startQueue() {
  if (queueRunning) return
  queueRunning = true
  processQueue().catch(console.error).finally(() => {
    queueRunning = false
    if (pendingQueue.length > 0) startQueue()
  })
}

async function processQueue() {
  while (pendingQueue.length > 0 && activeJobs.size < MAX_CONCURRENT) {
    const job = pendingQueue.shift()
    if (!job) continue
    if (cancelledJobs.has(job.jobId)) {
      job.reject(new Error('Indexing job cancelled before start'))
      continue
    }
    activeJobs.set(job.jobId, job)
    runJob(job).catch(console.error)
  }
}

async function runJob(job: PendingJob) {
  try {
    job.attempts++
    await prisma.document.update({
      where: { id: job.documentId },
      data: {
        status: 'indexing',
        indexingAttempts: job.attempts,
        errorMessage: null,
      },
    })

    const result = await indexDocumentChunks(job.documentId, job.text, job.filename, job.mimeType, job.settings)

    if (cancelledJobs.has(job.jobId)) {
      throw new Error('Indexing job cancelled during execution')
    }

    await prisma.document.update({
      where: { id: job.documentId },
      data: {
        status: 'ready',
        indexingProgress: 100,
        errorMessage: result.error ?? null,
      },
    })

    activeJobs.delete(job.jobId)
    job.resolve(result)
  } catch (error) {
    if (job.attempts < job.maxAttempts && !cancelledJobs.has(job.jobId)) {
      pendingQueue.push(job)
      await prisma.document.update({
        where: { id: job.documentId },
        data: {
          status: 'pending',
          indexingAttempts: job.attempts,
          errorMessage: `Retry ${job.attempts}/${job.maxAttempts}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      })
    } else {
      const message = error instanceof Error ? error.message : 'Unknown indexing error'
      await prisma.document.update({
        where: { id: job.documentId },
        data: {
          status: cancelledJobs.has(job.jobId) ? 'cancelled' : 'failed',
          indexingProgress: 0,
          errorMessage: message,
        },
      })
      job.reject(error instanceof Error ? error : new Error(message))
    }
  } finally {
    activeJobs.delete(job.jobId)
    if (pendingQueue.length > 0) startQueue()
  }
}

/** Re-index all ready documents that are not indexed for the current semantic model. */
export async function reindexDocumentsIfModelChanged(
  userId: string,
  newModel: string,
  settings: { ragMode: 'semantic' | 'keyword'; ollamaHost: string; ollamaApiKey: string },
): Promise<{ triggered: number; skipped: number }> {
  if (settings.ragMode === 'keyword') return { triggered: 0, skipped: 0 }

  const documents = await prisma.document.findMany({
    where: { userId, status: 'ready' },
    select: { id: true, filename: true, contentHash: true, embeddingModel: true, ragMode: true },
  })

  let triggered = 0
  let skipped = 0

  for (const doc of documents) {
    if (doc.ragMode === 'semantic' && doc.embeddingModel && isSameOllamaModel(doc.embeddingModel, newModel)) {
      skipped++
      continue
    }

    await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: 'pending',
        errorMessage: `RAG model/settings changed. Re-indexing required for "${doc.filename}".`,
      },
    })
    triggered++
  }

  return { triggered, skipped }
}
