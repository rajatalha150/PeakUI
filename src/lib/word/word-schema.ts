export type WordDocumentTemplate =
  | 'report'
  | 'memo'
  | 'letter'
  | 'proposal'
  | 'contract'
  | 'resume'
  | 'checklist'
  | 'form'

export interface WordDocumentField {
  label: string
  value: string
}

export interface WordDocumentTable {
  title?: string
  columns: string[]
  rows: Array<Record<string, string> | string[]>
}

export interface WordDocumentCallout {
  tone?: 'note' | 'warning' | 'success'
  title?: string
  text: string
}

export interface WordDocumentSection {
  heading?: string
  body?: string
  bullets?: string[]
  numbered?: string[]
  fields?: WordDocumentField[]
  tables?: WordDocumentTable[]
  callouts?: WordDocumentCallout[]
  pageBreakBefore?: boolean
}

export interface WordDocumentMetadata {
  author?: string
  subject?: string
  company?: string
  footer?: string
}

export interface WordDocumentInput {
  title: string
  content?: string
  filename?: string
  description?: string
  template?: WordDocumentTemplate
  subtitle?: string
  sections?: WordDocumentSection[]
  fields?: WordDocumentField[]
  tables?: WordDocumentTable[]
  callouts?: WordDocumentCallout[]
  metadata?: WordDocumentMetadata
}

export interface NormalizedWordDocument extends Required<Pick<WordDocumentInput, 'title'>> {
  content: string
  filename?: string
  description?: string
  template: WordDocumentTemplate
  subtitle?: string
  sections: WordDocumentSection[]
  fields: WordDocumentField[]
  tables: WordDocumentTable[]
  callouts: WordDocumentCallout[]
  metadata: WordDocumentMetadata
}

const TEMPLATE_VALUES = new Set<WordDocumentTemplate>([
  'report',
  'memo',
  'letter',
  'proposal',
  'contract',
  'resume',
  'checklist',
  'form',
])

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
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

function normalizeField(value: unknown): WordDocumentField | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const label = cleanString(record.label, 160)
  const rawValue = cleanString(record.value, 2000)
  if (!label || rawValue === undefined) return null
  return { label, value: cleanMarkdownText(rawValue) }
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

function normalizeTable(value: unknown): WordDocumentTable | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const columns = Array.isArray(record.columns)
    ? record.columns.flatMap(column => {
      const clean = cleanString(column, 80)
      return clean ? [cleanMarkdownText(clean)] : []
    }).slice(0, 12)
    : []
  if (columns.length === 0 || !Array.isArray(record.rows)) return null

  const rows: WordDocumentTable['rows'] = []
  for (const row of record.rows) {
    if (Array.isArray(row)) {
      rows.push(row.map(cell => cleanMarkdownText(String(cell ?? '')).slice(0, 600)).slice(0, columns.length))
      continue
    }
    if (row && typeof row === 'object') {
      const rowRecord = row as Record<string, unknown>
      rows.push(Object.fromEntries(columns.map(column => [column, cleanMarkdownText(String(rowRecord[column] ?? '')).slice(0, 600)])))
    }
    if (rows.length >= 120) break
  }

  if (rows.length === 0) return null
  return {
    title: cleanString(record.title, 160),
    columns,
    rows,
  }
}

function normalizeCallout(value: unknown): WordDocumentCallout | null {
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
    text: cleanMarkdownText(text),
  }
}

function extractMarkdownTables(text: string): { cleanText: string; tables: WordDocumentTable[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const cleanLines: string[] = []
  const tables: WordDocumentTable[] = []
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
      if (columns.length > 0 && rows.length > 0) tables.push({ columns, rows })
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

function normalizeSection(value: unknown): WordDocumentSection | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rawBody = cleanString(record.body, 12000)
  const bodyTables = rawBody ? extractMarkdownTables(rawBody) : { cleanText: undefined, tables: [] as WordDocumentTable[] }
  const explicitTables = Array.isArray(record.tables) ? record.tables.map(normalizeTable).filter((table): table is WordDocumentTable => Boolean(table)).slice(0, 8) : []
  const section: WordDocumentSection = {
    heading: cleanString(record.heading, 180),
    body: bodyTables.cleanText || undefined,
    bullets: Array.isArray(record.bullets)
      ? record.bullets.flatMap(item => {
        const clean = cleanString(item, 1000)
        return clean ? [cleanMarkdownText(clean)] : []
      }).slice(0, 60)
      : undefined,
    numbered: Array.isArray(record.numbered)
      ? record.numbered.flatMap(item => {
        const clean = cleanString(item, 1000)
        return clean ? [cleanMarkdownText(clean)] : []
      }).slice(0, 60)
      : undefined,
    fields: Array.isArray(record.fields) ? record.fields.map(normalizeField).filter((field): field is WordDocumentField => Boolean(field)).slice(0, 100) : undefined,
    tables: [...explicitTables, ...bodyTables.tables].slice(0, 8),
    callouts: Array.isArray(record.callouts) ? record.callouts.map(normalizeCallout).filter((callout): callout is WordDocumentCallout => Boolean(callout)).slice(0, 12) : undefined,
    pageBreakBefore: record.pageBreakBefore === true,
  }
  return section.heading || section.body || section.bullets?.length || section.numbered?.length || section.fields?.length || section.tables?.length || section.callouts?.length
    ? section
    : null
}

export function normalizeWordDocumentInput(input: WordDocumentInput): NormalizedWordDocument {
  const template = input.template && TEMPLATE_VALUES.has(input.template) ? input.template : 'report'
  const contentExtraction = typeof input.content === 'string'
    ? extractMarkdownTables(input.content.trim().slice(0, 80000))
    : { cleanText: '', tables: [] as WordDocumentTable[] }
  const metadataRecord = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}

  return {
    title: input.title.trim().slice(0, 160) || 'Generated Word Document',
    content: contentExtraction.cleanText,
    filename: input.filename,
    description: input.description,
    template,
    subtitle: input.subtitle?.trim().slice(0, 240),
    sections: Array.isArray(input.sections)
      ? input.sections.map(normalizeSection).filter((section): section is WordDocumentSection => Boolean(section)).slice(0, 40)
      : [],
    fields: Array.isArray(input.fields) ? input.fields.map(normalizeField).filter((field): field is WordDocumentField => Boolean(field)).slice(0, 140) : [],
    tables: [
      ...(Array.isArray(input.tables) ? input.tables.map(normalizeTable).filter((table): table is WordDocumentTable => Boolean(table)) : []),
      ...contentExtraction.tables,
    ].slice(0, 14),
    callouts: Array.isArray(input.callouts) ? input.callouts.map(normalizeCallout).filter((callout): callout is WordDocumentCallout => Boolean(callout)).slice(0, 24) : [],
    metadata: {
      author: cleanString((metadataRecord as WordDocumentMetadata).author, 160),
      subject: cleanString((metadataRecord as WordDocumentMetadata).subject, 240),
      company: cleanString((metadataRecord as WordDocumentMetadata).company, 160),
      footer: cleanString((metadataRecord as WordDocumentMetadata).footer, 240),
    },
  }
}

export function wordDocumentHasRenderableContent(document: NormalizedWordDocument): boolean {
  return Boolean(
    document.content
    || document.sections.length
    || document.fields.length
    || document.tables.length
    || document.callouts.length
  )
}
