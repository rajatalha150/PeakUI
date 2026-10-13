import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function ragSpoolPath(documentId: string): string {
  if (!documentIdPattern.test(documentId)) throw new Error('Invalid Knowledge Base document ID.')
  return join(process.env.PEAKUI_DATA_DIR || '/var/lib/peakui', 'rag-spool', `${documentId}.bin`)
}

export async function stageRagUpload(documentId: string, data: Buffer): Promise<void> {
  const target = ragSpoolPath(documentId)
  const temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(join(process.env.PEAKUI_DATA_DIR || '/var/lib/peakui', 'rag-spool'), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function readRagUpload(documentId: string): Promise<Buffer | null> {
  try {
    return await readFile(ragSpoolPath(documentId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function hasRagUpload(documentId: string): Promise<boolean> {
  try {
    return (await stat(ragSpoolPath(documentId))).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function removeRagUpload(documentId: string): Promise<void> {
  await rm(ragSpoolPath(documentId), { force: true })
}
