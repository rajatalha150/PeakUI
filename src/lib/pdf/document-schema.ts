export type PdfDocumentTemplate = 'report' | 'memo' | 'letter' | 'invoice' | 'checklist' | 'form'

export interface PdfDocumentField {
  label: string
  value: string
}

export interface PdfDocumentTable {
  title?: string
  columns: string[]
  rows: Array<Record<string, string> | string[]>
}

export interface PdfDocumentCallout {
  tone?: 'note' | 'warning' | 'success'
  title?: string
  text: string
}

export interface PdfDocumentSection {
  heading?: string
  body?: string
  bullets?: string[]
  fields?: PdfDocumentField[]
  tables?: PdfDocumentTable[]
  callouts?: PdfDocumentCallout[]
}

export interface PdfDocumentMetadata {
  author?: string
  subject?: string
  footer?: string
}

export interface PdfDocumentInput {
  title: string
  content?: string
  filename?: string
  description?: string
  template?: PdfDocumentTemplate
  subtitle?: string
  sections?: PdfDocumentSection[]
  fields?: PdfDocumentField[]
  tables?: PdfDocumentTable[]
  callouts?: PdfDocumentCallout[]
  metadata?: PdfDocumentMetadata
}

export interface NormalizedPdfDocument extends Required<Pick<PdfDocumentInput, 'title'>> {
  content: string
  filename?: string
  description?: string
  template: PdfDocumentTemplate
  subtitle?: string
  sections: PdfDocumentSection[]
  fields: PdfDocumentField[]
  tables: PdfDocumentTable[]
  callouts: PdfDocumentCallout[]
  metadata: PdfDocumentMetadata
}

const TEMPLATE_VALUES = new Set<PdfDocumentTemplate>(['report', 'memo', 'letter', 'invoice', 'checklist', 'form'])

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

function normalizeField(value: unknown): PdfDocumentField | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const label = cleanString(record.label, 160)
  const rawValue = cleanString(record.value, 2000)
  if (!label || rawValue === undefined) return null
  return { label, value: rawValue }
}

function normalizeTable(value: unknown): PdfDocumentTable | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const columns = Array.isArray(record.columns)
    ? record.columns.flatMap(column => {
      const clean = cleanString(column, 80)
      return clean ? [clean] : []
    }).slice(0, 12)
    : []
  if (columns.length === 0 || !Array.isArray(record.rows)) return null

  const rows: PdfDocumentTable['rows'] = []
  for (const row of record.rows) {
    if (Array.isArray(row)) {
      rows.push(row.map(cell => String(cell ?? '').slice(0, 600)).slice(0, columns.length))
      continue
    }
    if (row && typeof row === 'object') {
      const rowRecord = row as Record<string, unknown>
      rows.push(Object.fromEntries(columns.map(column => [column, String(rowRecord[column] ?? '').slice(0, 600)])))
    }
    if (rows.length >= 80) break
  }

  if (rows.length === 0) return null
  return {
    title: cleanString(record.title, 160),
    columns,
    rows,
  }
}

function normalizeCallout(value: unknown): PdfDocumentCallout | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const text = cleanString(record.text, 2000)
  if (!text) return null
  const tone = record.tone === 'warning' || record.tone === 'success' || record.tone === 'note'
    ? record.tone
    : undefined
  return {
    tone,
    title: cleanString(record.title, 160),
    text,
  }
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cleanMarkdownText(cell.trim()).slice(0, 600))
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function extractMarkdownTables(text: string): { cleanText: string; tables: PdfDocumentTable[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const cleanLines: string[] = []
  const tables: PdfDocumentTable[] = []
  let index = 0

  while (index < lines.length) {
    const header = lines[index]
    const separator = lines[index + 1]
    if (header?.includes('|') && separator && isMarkdownTableSeparator(separator)) {
      const columns = splitMarkdownRow(header).filter(Boolean)
      const rows: Array<Record<string, string>> = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && !isMarkdownTableSeparator(lines[index])) {
        const cells = splitMarkdownRow(lines[index])
        if (cells.some(Boolean)) {
          rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, cells[columnIndex] ?? ''])))
        }
        index += 1
      }
      if (columns.length > 0 && rows.length > 0) {
        tables.push({ columns, rows })
      }
      continue
    }

    cleanLines.push(lines[index])
    index += 1
  }

  return {
    cleanText: cleanMarkdownText(cleanLines.join('\n')),
    tables,
  }
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeSection(value: unknown): PdfDocumentSection | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rawBody = cleanString(record.body, 8000)
  const bodyTables = rawBody ? extractMarkdownTables(rawBody) : { cleanText: undefined, tables: [] as PdfDocumentTable[] }
  const explicitTables = Array.isArray(record.tables) ? record.tables.map(normalizeTable).filter((table): table is PdfDocumentTable => Boolean(table)).slice(0, 8) : []
  const section: PdfDocumentSection = {
    heading: cleanString(record.heading, 180),
    body: bodyTables.cleanText || undefined,
    bullets: Array.isArray(record.bullets)
      ? record.bullets.flatMap(item => {
        const clean = cleanString(item, 800)
        return clean ? [cleanMarkdownText(clean)] : []
      }).slice(0, 40)
      : undefined,
    fields: Array.isArray(record.fields) ? record.fields.map(normalizeField).filter((field): field is PdfDocumentField => Boolean(field)).slice(0, 80) : undefined,
    tables: [...explicitTables, ...bodyTables.tables].slice(0, 8),
    callouts: Array.isArray(record.callouts) ? record.callouts.map(normalizeCallout).filter((callout): callout is PdfDocumentCallout => Boolean(callout)).slice(0, 12) : undefined,
  }
  return section.heading || section.body || section.bullets?.length || section.fields?.length || section.tables?.length || section.callouts?.length
    ? section
    : null
}

export function normalizePdfDocumentInput(input: PdfDocumentInput): NormalizedPdfDocument {
  const template = input.template && TEMPLATE_VALUES.has(input.template) ? input.template : 'report'
  const contentExtraction = typeof input.content === 'string'
    ? extractMarkdownTables(input.content.trim().slice(0, 60000))
    : { cleanText: '', tables: [] as PdfDocumentTable[] }
  const content = contentExtraction.cleanText
  const sections = Array.isArray(input.sections)
    ? input.sections.map(normalizeSection).filter((section): section is PdfDocumentSection => Boolean(section)).slice(0, 30)
    : []
  const fields = Array.isArray(input.fields) ? input.fields.map(normalizeField).filter((field): field is PdfDocumentField => Boolean(field)).slice(0, 120) : []
  const tables = [
    ...(Array.isArray(input.tables) ? input.tables.map(normalizeTable).filter((table): table is PdfDocumentTable => Boolean(table)) : []),
    ...contentExtraction.tables,
  ].slice(0, 12)
  const callouts = Array.isArray(input.callouts) ? input.callouts.map(normalizeCallout).filter((callout): callout is PdfDocumentCallout => Boolean(callout)).slice(0, 20) : []
  const metadataRecord = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}

  return {
    title: input.title.trim().slice(0, 160) || 'Generated PDF',
    content,
    filename: input.filename,
    description: input.description,
    template,
    subtitle: input.subtitle?.trim().slice(0, 240),
    sections,
    fields,
    tables,
    callouts,
    metadata: {
      author: cleanString((metadataRecord as PdfDocumentMetadata).author, 160),
      subject: cleanString((metadataRecord as PdfDocumentMetadata).subject, 240),
      footer: cleanString((metadataRecord as PdfDocumentMetadata).footer, 240),
    },
  }
}

export function pdfDocumentHasRenderableContent(document: NormalizedPdfDocument): boolean {
  return Boolean(
    document.content
    || document.sections.length
    || document.fields.length
    || document.tables.length
    || document.callouts.length
  )
}
