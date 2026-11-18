import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { prisma } from './prisma'
import { getEmbeddings } from './rag'
import { isPgvectorEnabled, normalizeVectorDimensions, vectorToPgLiteral } from './rag-engine'

const TARGET_CHARS = 1800
const BATCH_SIZE = 12

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return String(value)
  if ('formula' in value || 'sharedFormula' in value) {
    const formula = 'formula' in value ? value.formula : value.sharedFormula
    return `${value.result === undefined ? '' : String(value.result)} (= ${formula ?? ''})`.trim()
  }
  if ('richText' in value) return value.richText.map(part => part.text).join('')
  if ('text' in value) return String(value.text)
  if ('error' in value) return String(value.error)
  return JSON.stringify(value)
}

function rowText(row: ExcelJS.Row): string {
  const cells: string[] = []
  row.eachCell({ includeEmpty: false }, cell => {
    const value = cellText(cell.value).replace(/\s+/g, ' ').trim()
    if (value) cells.push(`${cell.address.replace(/\d+$/, '')}=${value}`)
  })
  return cells.length ? `Row ${row.number}: ${cells.join(' | ')}` : ''
}

/** Stream every nonempty row, including rows beyond the old 200-row preview. */
export async function* readWorkbookChunks(filePath: string): AsyncGenerator<{ content: string; section: string }> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', entries: 'ignore',
  })
  for await (const sheet of reader) {
    let lines: string[] = []
    let length = 0
    let firstRow = 0
    let lastRow = 0
    const sheetInfo = sheet as unknown as { name?: string; id?: number }
    const sheetName = sheetInfo.name || `Sheet ${sheetInfo.id ?? 'unknown'}`
    for await (const row of sheet) {
      const line = rowText(row)
      if (!line) continue
      // A very wide cell must not turn one embedding request into an unbounded payload.
      for (let start = 0; start < line.length; start += TARGET_CHARS) {
        const part = line.slice(start, start + TARGET_CHARS)
        if (lines.length && length + part.length > TARGET_CHARS) {
          yield { content: `Sheet: ${sheetName}\nRows: ${firstRow}-${lastRow}\n${lines.join('\n')}`, section: `${sheetName} rows ${firstRow}-${lastRow}` }
          lines = []
          length = 0
        }
        if (!lines.length) firstRow = row.number
        lastRow = row.number
        lines.push(start === 0 ? part : `Row ${row.number} (continued): ${part}`)
        length += part.length
      }
    }
    if (lines.length) yield { content: `Sheet: ${sheetName}\nRows: ${firstRow}-${lastRow}\n${lines.join('\n')}`, section: `${sheetName} rows ${firstRow}-${lastRow}` }
  }
}

export async function indexWorkbookChunks(
  documentId: string,
  contentHash: string | null,
  filePath: string,
  settings: { ragModel: string; ragMode: 'semantic' | 'keyword'; ollamaHost: string; ollamaApiKey: string },
): Promise<{ chunkCount: number; mode: 'semantic' | 'keyword' }> {
  const pgvector = await isPgvectorEnabled()
  await prisma.documentChunk.deleteMany({ where: { documentId } })
  const mode = settings.ragMode
  let count = 0
  let embeddingDimensions: number | null = null
  let batch: Array<{ content: string; section: string }> = []

  async function flush() {
    if (!batch.length) return
    let embeddings: number[][] = []
    if (mode === 'semantic') {
      // Never mark a partially embedded workbook ready. The worker records the
      // failed batch as an indexing error so the user can retry it.
      embeddings = await getEmbeddings(batch.map(chunk => chunk.content), settings.ragModel, settings.ollamaHost, settings.ollamaApiKey, 120_000)
      embeddingDimensions = embeddings[0]?.length ?? null
    }
    const current = await prisma.document.findUnique({ where: { id: documentId }, select: { status: true, contentHash: true } })
    if (!current || current.status !== 'processing' || current.contentHash !== contentHash) {
      throw new Error('Workbook was replaced or removed during indexing.')
    }
    const rows = batch.map((chunk, offset) => ({
      id: randomUUID(), documentId, chunkIndex: count + offset, content: chunk.content,
      embedding: mode === 'semantic' ? JSON.stringify(embeddings[offset]) : null,
      metadata: JSON.stringify({ section: chunk.section, boundary: 'table' }),
      vector: mode === 'semantic' ? vectorToPgLiteral(normalizeVectorDimensions(embeddings[offset])) : null,
    }))
    if (pgvector) {
      const values = rows.map(row => `('${row.id}', ${row.chunkIndex}, '${row.content.replace(/'/g, "''")}', ${row.embedding ? `'${row.embedding}'` : 'NULL'}, '${row.metadata.replace(/'/g, "''")}'::jsonb, '${documentId}', ${row.vector ? `'${row.vector}'::vector` : 'NULL'})`).join(',\n')
      await prisma.$executeRawUnsafe(`INSERT INTO "DocumentChunk" ("id", "chunkIndex", "content", "embedding", "metadata", "documentId", "vector") VALUES ${values}`)
    } else {
      await prisma.documentChunk.createMany({ data: rows.map(({ id, documentId: rowDocumentId, chunkIndex, content, embedding, metadata }) => ({
        id, documentId: rowDocumentId, chunkIndex, content, embedding, metadata: JSON.parse(metadata),
      })) })
    }
    count += rows.length
    batch = []
  }

  for await (const chunk of readWorkbookChunks(filePath)) {
    batch.push(chunk)
    if (batch.length >= BATCH_SIZE) await flush()
  }
  await flush()
  if (count === 0) throw new Error('No searchable workbook rows were found.')
  const completed = await prisma.document.updateMany({
    where: { id: documentId, status: 'processing', contentHash },
    data: {
      status: 'ready', ragMode: mode,
      embeddingModel: mode === 'semantic' ? settings.ragModel : null,
      embeddingDimensions: mode === 'semantic' ? embeddingDimensions : null,
      ollamaHost: mode === 'semantic' ? settings.ollamaHost : null,
      indexedAt: new Date(),
      errorMessage: null,
    },
  })
  if (completed.count !== 1) throw new Error('Workbook was replaced or removed during indexing.')
  return { chunkCount: count, mode }
}
