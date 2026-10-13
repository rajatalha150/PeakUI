import { setTimeout as sleep } from 'node:timers/promises'
import { prisma } from '../src/lib/prisma'
import { getUserSettings } from '../src/lib/settings'
import { extractFilePayload } from '../src/lib/file-extraction'
import { indexDocumentChunks } from '../src/lib/rag-engine'
import { hasRagUpload, readRagUpload, removeRagUpload } from '../src/lib/rag-spool'

const MAX_RAG_TEXT_CHARS = 2_000_000
let stopping = false

process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

async function processNextDocument(): Promise<boolean> {
  const document = await prisma.document.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, userId: true, filename: true, size: true,
      originalMimeType: true, originalContent: true, contentHash: true, indexingAttempts: true,
    },
  })
  if (!document) return false

  const claimed = await prisma.document.updateMany({
    where: { id: document.id, status: 'queued' },
    data: { status: 'processing', indexedAt: new Date(), errorMessage: null, indexingAttempts: { increment: 1 } },
  })
  if (claimed.count !== 1) return true

  try {
    const buffer = await readRagUpload(document.id)
      ?? (document.originalContent ? Buffer.from(document.originalContent, 'base64') : null)
    if (!buffer) throw new Error('Original file is unavailable. Upload it again to re-index.')

    const settings = await getUserSettings(document.userId)
    const mimeType = document.originalMimeType || 'application/octet-stream'
    console.info(`RAG worker indexing ${document.filename} (${document.id})`)
    const extraction = await extractFilePayload({
      name: document.filename,
      type: mimeType,
      size: document.size,
      buffer,
      maxTextChars: MAX_RAG_TEXT_CHARS,
      includePdfPageImages: false,
    })
    if (!extraction.text?.trim()) {
      throw new Error(extraction.statusMessage || 'No searchable text could be extracted from this file.')
    }

    // A replacement upload can arrive while extraction is running. Never let
    // an older job overwrite its new file's status or search chunks.
    const current = await prisma.document.findUnique({ where: { id: document.id }, select: { contentHash: true, status: true } })
    if (!current || current.contentHash !== document.contentHash || current.status !== 'processing') return true

    await indexDocumentChunks(document.id, extraction.text, document.filename, mimeType, {
      ragModel: settings.ragModel,
      ragMode: settings.ragMode === 'keyword' ? 'keyword' : 'semantic',
      ollamaHost: settings.ollamaHost,
      ollamaApiKey: settings.ollamaApiKey ?? '',
    })
    console.info(`RAG worker indexed ${document.filename} (${document.id})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`RAG worker failed ${document.filename} (${document.id}):`, error)
    await prisma.document.updateMany({
      where: { id: document.id, status: 'processing', contentHash: document.contentHash },
      data: { status: 'error', errorMessage: message, indexedAt: null },
    })
  } finally {
    const status = await prisma.document.findUnique({ where: { id: document.id }, select: { status: true, originalContent: true } })
    // Keep the spool for types not retained in PostgreSQL, so later model
    // changes can reindex without forcing the user to upload again.
    if (!status || status.status === 'error' || (status.status === 'ready' && status.originalContent)) {
      await removeRagUpload(document.id).catch(error => console.error('RAG spool cleanup failed:', error))
    }
  }
  return true
}

async function main() {
  await recoverInterrupted(true)
  let lastRecovery = Date.now()
  while (!stopping) {
    try {
      if (Date.now() - lastRecovery > 60_000) {
        await recoverInterrupted(false)
        lastRecovery = Date.now()
      }
      if (!await processNextDocument()) await sleep(1_000)
    } catch (error) {
      console.error('RAG worker queue error:', error)
      await sleep(5_000)
    }
  }
}

async function recoverInterrupted(startup: boolean) {
  const documents = await prisma.document.findMany({
    where: {
      status: { in: ['staging', 'processing', 'indexing'] },
      ...(!startup ? { updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } } : {}),
    },
    select: { id: true, status: true, indexingAttempts: true, originalContent: true },
  })
  for (const document of documents) {
    const canRetry = (document.indexingAttempts ?? 0) < 3
    const hasOriginal = Boolean(document.originalContent) || await hasRagUpload(document.id)
    await prisma.document.updateMany({
      where: { id: document.id, status: document.status },
      data: canRetry && hasOriginal
        ? { status: 'queued', indexedAt: null }
        : { status: 'error', errorMessage: canRetry ? 'Upload was interrupted. Upload the file again.' : 'Indexing failed repeatedly. Upload the file again.', indexedAt: null },
    })
  }
}

main().catch(error => { console.error('RAG worker startup failed:', error); process.exitCode = 1 })
