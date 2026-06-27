import type { Archiver, ArchiverOptions } from 'archiver'
import type { ArchiveDocumentEntry, NormalizedArchiveDocument } from './archive-schema'

// archiver is a CommonJS module; @types/archiver exposes Archiver (class) and
// CoreOptions (constructor options) but not the top-level create() helper.
// We require() the runtime module via a locally-scoped declaration.
type ArchiverFactory = (format: 'zip', options?: ArchiverOptions) => Archiver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiverModule = require('archiver') as ArchiverFactory | { default: ArchiverFactory }
const archiverCreate: ArchiverFactory = (archiverModule as { default?: ArchiverFactory }).default ?? (archiverModule as ArchiverFactory)

function isBase64Mime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
    || mimeType.startsWith('audio/')
    || mimeType.startsWith('video/')
    || mimeType === 'application/pdf'
    || mimeType === 'application/zip'
    || mimeType.startsWith('application/vnd.openxmlformats-officedocument.')
    || mimeType.startsWith('application/vnd.ms-')
}

function entryToBuffer(entry: ArchiveDocumentEntry): { data: Buffer; mimeType: string } {
  const mimeType = entry.mimeType || 'application/octet-stream'
  if (isBase64Mime(mimeType)) {
    return { data: Buffer.from(entry.content.replace(/\s+/g, ''), 'base64'), mimeType }
  }
  return { data: Buffer.from(entry.content, 'utf8'), mimeType }
}

export async function renderArchiveDocument(document: NormalizedArchiveDocument): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const archive = archiverCreate('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []
    archive.on('data', chunk => chunks.push(chunk as Buffer))
    archive.on('warning', err => console.warn('[archive-renderer] warning:', err))
    archive.on('error', err => reject(err))
    archive.on('end', () => resolve(Buffer.concat(chunks)))

    for (const entry of document.entries) {
      const { data } = entryToBuffer(entry)
      archive.append(data, { name: entry.name })
    }
    void archive.finalize()
  })
}