import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import { decodeArtifactContent } from '@/lib/canvas-download'

export const runtime = 'nodejs'
export const maxDuration = 60

interface PreviewSpreadsheetSheet {
  name: string
  columns: string[]
  rows: string[][]
}

interface PreviewDocumentSection {
  heading?: string
  paragraphs: string[]
  tables: PreviewSpreadsheetSheet[]
}

export type PreviewPayload =
  | { kind: 'spreadsheet'; sheets: PreviewSpreadsheetSheet[] }
  | { kind: 'document'; sections: PreviewDocumentSection[] }
  | { kind: 'email'; from: string; to: string; cc: string[]; subject: string; date: string; body: string; htmlBody?: string }
  | { kind: 'slides'; slides: Array<{ title: string; bullets: string[] }> }
  | { kind: 'mermaid'; source: string }
  | { kind: 'unsupported'; reason: string }

// `decodeArtifact` is retained as a thin alias for the shared classifier so
// historical call sites that already-passed mime types keep working. New code
// should call `decodeArtifactContent` from `lib/canvas-download` directly.
const decodeArtifact = (content: string, mimeType: string): Buffer =>
  decodeArtifactContent(content, mimeType)

async function previewSpreadsheet(bytes: Buffer): Promise<PreviewSpreadsheetSheet[]> {
  const workbook = new ExcelJS.Workbook()
  // exceljs readBuffer expects ArrayBuffer | Buffer
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
  const sheets: PreviewSpreadsheetSheet[] = []
  workbook.eachSheet((worksheet) => {
    const rows: string[][] = []
    let columns: string[] = []
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1) // exceljs prefixes with undefined
      const cells = values.map((cell) => {
        if (cell === null || cell === undefined) return ''
        if (typeof cell === 'object') {
          const obj = cell as { text?: unknown; result?: unknown; richText?: unknown }
          if (typeof obj.text === 'string') return obj.text
          if (obj.richText && Array.isArray(obj.richText)) {
            return (obj.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('')
          }
          if ('result' in obj) return String((obj as { result: unknown }).result ?? '')
          try {
            return JSON.stringify(cell)
          } catch {
            return String(cell)
          }
        }
        return String(cell)
      })
      if (rowNumber === 1) {
        columns = cells.map((c) => c.trim()).filter(Boolean)
      }
      rows.push(cells)
      if (rows.length >= 200) return
    })
    sheets.push({ name: worksheet.name, columns, rows })
  })
  return sheets
}

function htmlToSections(html: string): PreviewDocumentSection[] {
  // Strip doctype / html wrappers; mammoth returns a fragment with headings + paragraphs.
  const sections: PreviewDocumentSection[] = []
  let current: PreviewDocumentSection = { paragraphs: [], tables: [] }

  const flushCurrent = () => {
    if (current.paragraphs.length > 0 || current.tables.length > 0 || current.heading) {
      sections.push(current)
    }
    current = { paragraphs: [], tables: [] }
  }

  const tagPattern = /<\/?(h1|h2|h3|h4|h5|h6|p|table)([^>]*)>|<\/tr>|<\/td>|<\/th>|<br\s*\/?>/gi
  let cursor = 0
  let inTable = false
  let tableRows: string[][] = []
  let tableColumns: string[] = []
  let rowCells: string[] = []
  let inCell = false

  const consumeText = (start: number, end: number) => {
    const text = html.slice(start, end)
    if (!text) return ''
    // Strip tags inside the slice to get plain text
    return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
  }

  for (const match of html.matchAll(tagPattern)) {
    const index = match.index ?? 0
    const fullTag = match[0]
    const tagName = (match[1] || '').toLowerCase()
    const isClose = fullTag.startsWith('</')

    if (!inTable) {
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        if (!isClose) {
          // Heading open — consume text until the closing tag
          const closePattern = new RegExp(`</${tagName}>`, 'i')
          const closeMatch = closePattern.exec(html.slice(index))
          const textEnd = closeMatch ? index + closeMatch.index : html.length
          const text = consumeText(index + fullTag.length, textEnd)
          flushCurrent()
          current = { heading: text, paragraphs: [], tables: [] }
          cursor = textEnd + closeMatch![0].length
        }
      } else if (tagName === 'p') {
        if (!isClose) {
          const closeMatch = /<\/p>/i.exec(html.slice(index))
          const textEnd = closeMatch ? index + closeMatch.index : html.length
          const text = consumeText(index + fullTag.length, textEnd)
          if (text) current.paragraphs.push(text)
          cursor = textEnd + (closeMatch?.[0].length ?? 0)
        }
      } else if (tagName === 'table') {
        if (!isClose) {
          inTable = true
          tableColumns = []
          tableRows = []
          rowCells = []
        }
      }
    } else {
      if (tagName === 'table' && isClose) {
        inTable = false
        if (tableRows.length > 0) {
          current.tables.push({
            name: current.heading ? `${current.heading} table` : 'Table',
            columns: tableColumns.length > 0 ? tableColumns : (tableRows[0] ?? []).map((_, i) => `Column ${i + 1}`),
            rows: tableRows,
          })
        }
        tableColumns = []
        tableRows = []
        rowCells = []
      } else if ((tagName === 'td' || tagName === 'th') && !isClose) {
        inCell = true
      } else if ((tagName === 'td' || tagName === 'th') && isClose) {
        inCell = false
      } else if (tagName === 'tr' && isClose) {
        if (rowCells.length > 0) {
          if (tableColumns.length === 0) tableColumns = rowCells
          else tableRows.push(rowCells)
        }
        rowCells = []
      } else if (inCell) {
        const text = consumeText(index, index + fullTag.length)
        if (text) rowCells.push(text)
      }
    }
  }

  flushCurrent()
  return sections.length > 0 ? sections : [{ paragraphs: [consumeText(0, html.length)].filter(Boolean), tables: [] }]
}

async function previewDocument(bytes: Buffer): Promise<PreviewDocumentSection[]> {
  let mammoth: typeof import('mammoth')
  try {
    mammoth = await import('mammoth')
  } catch {
    return [{ paragraphs: ['Mammoth is not installed; document preview unavailable.'], tables: [] }]
  }
  const result = await mammoth.convertToHtml({ buffer: bytes })
  return htmlToSections(result.value || '')
}

function previewEmail(bytes: Buffer): PreviewPayload & { kind: 'email' } {
  const text = bytes.toString('utf8')
  // Split headers from body on the first blank line
  const headerEnd = text.indexOf('\r\n\r\n') !== -1
    ? text.indexOf('\r\n\r\n')
    : text.indexOf('\n\n')
  const headerBlock = headerEnd > -1 ? text.slice(0, headerEnd) : text
  const bodyBlock = headerEnd > -1 ? text.slice(headerEnd).replace(/^\r\n\r\n|^\n\n/, '') : ''

  const headers: Record<string, string> = {}
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    headers[name] = value
  }

  // If multipart, just return the raw body (full .eml viewer would parse parts;
  // this keeps the inline preview simple and safe).
  return {
    kind: 'email',
    from: headers['from'] ?? '',
    to: headers['to'] ?? '',
    cc: (headers['cc'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    subject: headers['subject'] ?? '',
    date: headers['date'] ?? '',
    body: bodyBlock,
  }
}

function previewSlides(bytes: Buffer): PreviewPayload & { kind: 'slides' } {
  // Without pptx parsing on the server, surface a manifest: the raw bytes are
  // a zip; list the slide xml filenames and extract their first heading text.
  // Simplest reliable signal: scan slide XML files inside the zip and grab
  // the first <a:t>...</a:t> per slide. We can do this by searching the byte
  // ranges of slideN.xml entries.
  const slideList: Array<{ title: string; bullets: string[] }> = []
  const text = bytes.toString('binary')
  const slideMatches = [...text.matchAll(/ppt\/slides\/slide(\d+)\.xml/g)]
  slideMatches.sort((a, b) => Number(a[1]) - Number(b[1]))
  for (const m of slideMatches.slice(0, 50)) {
    const slideNum = m[1]
    // Find approximate end of this slide xml entry
    const startIdx = m.index ?? 0
    const nextIdx = text.indexOf(`ppt/slides/slide${Number(slideNum) + 1}.xml`, startIdx + 1)
    const endIdx = nextIdx === -1 ? text.indexOf('ppt/slides/slideLayout', startIdx) : nextIdx
    const slice = endIdx > startIdx ? text.slice(startIdx, endIdx) : ''
    const texts: string[] = []
    const re = /<a:t>([^<]{0,200})<\/a:t>/g
    let tm: RegExpExecArray | null
    while ((tm = re.exec(slice)) !== null && texts.length < 12) {
      const t = tm[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim()
      if (t) texts.push(t)
    }
    slideList.push({ title: texts[0] || `Slide ${slideNum}`, bullets: texts.slice(1, 6) })
  }
  return { kind: 'slides', slides: slideList }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      select: {
        id: true,
        name: true,
        content: true,
        mimeType: true,
        kind: true,
        presentationType: true,
        previewKind: true,
        extension: true,
      },
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const bytes = decodeArtifact(artifact.content, artifact.mimeType)
    let preview: PreviewPayload

    if (artifact.previewKind === 'spreadsheet' || artifact.presentationType === 'workbook') {
      preview = { kind: 'spreadsheet', sheets: await previewSpreadsheet(bytes) }
    } else if (artifact.previewKind === 'document' || artifact.presentationType === 'word') {
      preview = { kind: 'document', sections: await previewDocument(bytes) }
    } else if (artifact.mimeType === 'message/rfc822' || artifact.kind === 'email' || artifact.extension === 'eml') {
      preview = previewEmail(bytes)
    } else if (artifact.presentationType === 'slides-deck' || artifact.extension === 'pptx' || artifact.mimeType.includes('presentationml')) {
      preview = previewSlides(bytes)
    } else if (artifact.previewKind === 'mermaid' || artifact.presentationType === 'diagram-mermaid' || artifact.kind === 'diagram-mermaid' || (artifact.extension === 'mmd' || artifact.extension === 'mermaid')) {
      const text = bytes.toString('utf8')
      preview = { kind: 'mermaid', source: text }
    } else {
      preview = { kind: 'unsupported', reason: 'Preview not available for this artifact type' }
    }

    return NextResponse.json({ preview })
  } catch (error) {
    console.error('[canvas/artifacts/preview] GET error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Preview failed',
    }, { status: 500 })
  }
}