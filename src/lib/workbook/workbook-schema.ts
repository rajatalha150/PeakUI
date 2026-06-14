export type WorkbookTemplate =
  | 'workbook'
  | 'report'
  | 'invoice'
  | 'budget'
  | 'timesheet'
  | 'ledger'
  | 'inventory'
  | 'schedule'
  | 'tracker'

export interface WorkbookColumn {
  header: string
  key?: string
  width?: number
  type?: 'text' | 'number' | 'currency' | 'date' | 'percent' | 'boolean'
}

export interface WorkbookTable {
  title?: string
  columns: WorkbookColumn[]
  rows: Array<Record<string, string | number | boolean | null> | Array<string | number | boolean | null>>
  totals?: Array<{
    label: string
    column: string
    formula?: 'sum' | 'average' | 'count' | 'min' | 'max'
    value?: string | number
  }>
}

export interface WorkbookSheet {
  name: string
  title?: string
  subtitle?: string
  columns?: WorkbookColumn[]
  rows?: Array<Record<string, string | number | boolean | null> | Array<string | number | boolean | null>>
  tables?: WorkbookTable[]
  notes?: string[]
  freezeHeader?: boolean
  autoFilter?: boolean
}

export interface WorkbookDocumentInput {
  title: string
  filename?: string
  description?: string
  template?: WorkbookTemplate
  sheets?: WorkbookSheet[]
  metadata?: {
    creator?: string
    subject?: string
    company?: string
    currency?: string
  }
}

export interface NormalizedWorkbookDocument {
  title: string
  filename?: string
  description?: string
  template: WorkbookTemplate
  sheets: WorkbookSheet[]
  metadata: {
    creator?: string
    subject?: string
    company?: string
    currency: string
  }
}

const TEMPLATE_VALUES = new Set<WorkbookTemplate>([
  'workbook',
  'report',
  'invoice',
  'budget',
  'timesheet',
  'ledger',
  'inventory',
  'schedule',
  'tracker',
])

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

function safeSheetName(value: string, fallback: string): string {
  const clean = value
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
  return clean || fallback
}

function normalizeCellValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 5000)
  if (value === null || value === undefined) return null
  return String(value).slice(0, 5000)
}

function normalizeColumn(value: unknown, fallbackIndex: number): WorkbookColumn | null {
  if (typeof value === 'string') {
    const header = cleanString(value, 120)
    return header ? { header, key: header } : null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const header = cleanString(record.header, 120) || cleanString(record.key, 120)
  if (!header) return null
  const type = record.type === 'number' || record.type === 'currency' || record.type === 'date' || record.type === 'percent' || record.type === 'boolean' || record.type === 'text'
    ? record.type
    : undefined
  const width = typeof record.width === 'number' && Number.isFinite(record.width)
    ? Math.max(8, Math.min(60, record.width))
    : undefined
  return {
    header,
    key: cleanString(record.key, 120) || header || `Column ${fallbackIndex + 1}`,
    width,
    type,
  }
}

function inferColumnsFromRows(rows: WorkbookTable['rows']): WorkbookColumn[] {
  const firstRecord = rows.find(row => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown> | undefined
  if (firstRecord) {
    return Object.keys(firstRecord).slice(0, 24).map(key => ({ header: key, key }))
  }
  const firstArray = rows.find(Array.isArray) as unknown[] | undefined
  if (firstArray) {
    return firstArray.slice(0, 24).map((_, index) => ({ header: `Column ${index + 1}`, key: `Column ${index + 1}` }))
  }
  return []
}

function normalizeRows(rows: unknown, columns: WorkbookColumn[]): WorkbookTable['rows'] {
  if (!Array.isArray(rows)) return []
  const normalizedRows: WorkbookTable['rows'] = []
  for (const row of rows) {
    if (normalizedRows.length >= 5000) break
    if (Array.isArray(row)) {
      normalizedRows.push(row.slice(0, columns.length || 24).map(normalizeCellValue))
      continue
    }
    if (row && typeof row === 'object') {
      const record = row as Record<string, unknown>
      const normalized: Record<string, string | number | boolean | null> = {}
      for (const column of columns) {
        const key = column.key || column.header
        normalized[key] = normalizeCellValue(record[key] ?? record[column.header])
      }
      normalizedRows.push(normalized)
    }
  }
  return normalizedRows
}

function normalizeTotals(value: unknown): NonNullable<WorkbookTable['totals']> {
  if (!Array.isArray(value)) return []
  const totals: NonNullable<WorkbookTable['totals']> = []
  for (const entry of value) {
    if (totals.length >= 20) break
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const label = cleanString(record.label, 120)
    const column = cleanString(record.column, 120)
    const formula: NonNullable<WorkbookTable['totals']>[number]['formula'] = record.formula === 'sum' || record.formula === 'average' || record.formula === 'count' || record.formula === 'min' || record.formula === 'max'
      ? record.formula
      : undefined
    if (!label || !column) continue
    totals.push({
      label,
      column,
      formula,
      value: typeof record.value === 'number' || typeof record.value === 'string' ? record.value : undefined,
    })
  }
  return totals
}

function normalizeTable(value: unknown, fallbackTitle?: string): WorkbookTable | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const preliminaryRows = Array.isArray(record.rows) ? record.rows as WorkbookTable['rows'] : []
  const columns = Array.isArray(record.columns)
    ? record.columns.map(normalizeColumn).filter((column): column is WorkbookColumn => Boolean(column)).slice(0, 24)
    : inferColumnsFromRows(preliminaryRows)
  if (columns.length === 0) return null
  const rows = normalizeRows(record.rows, columns)
  if (rows.length === 0) return null
  return {
    title: cleanString(record.title, 160) || fallbackTitle,
    columns,
    rows,
    totals: normalizeTotals(record.totals),
  }
}

function normalizeSheet(value: unknown, index: number): WorkbookSheet | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = safeSheetName(cleanString(record.name, 80) || `Sheet ${index + 1}`, `Sheet ${index + 1}`)
  const baseColumns = Array.isArray(record.columns)
    ? record.columns.map(normalizeColumn).filter((column): column is WorkbookColumn => Boolean(column)).slice(0, 24)
    : []
  const baseRows = normalizeRows(record.rows, baseColumns.length ? baseColumns : inferColumnsFromRows(Array.isArray(record.rows) ? record.rows as WorkbookTable['rows'] : []))
  const baseTable = baseRows.length
    ? normalizeTable({ title: cleanString(record.title, 160) || name, columns: baseColumns.length ? baseColumns : inferColumnsFromRows(baseRows), rows: baseRows })
    : null
  const tables = [
    ...(baseTable ? [baseTable] : []),
    ...(Array.isArray(record.tables)
      ? record.tables.map(table => normalizeTable(table)).filter((table): table is WorkbookTable => Boolean(table))
      : []),
  ].slice(0, 10)

  if (tables.length === 0) return null
  return {
    name,
    title: cleanString(record.title, 160),
    subtitle: cleanString(record.subtitle, 240),
    tables,
    notes: Array.isArray(record.notes)
      ? record.notes.flatMap(note => {
        const clean = cleanString(note, 600)
        return clean ? [clean] : []
      }).slice(0, 20)
      : undefined,
    freezeHeader: record.freezeHeader !== false,
    autoFilter: record.autoFilter !== false,
  }
}

export function normalizeWorkbookDocumentInput(input: WorkbookDocumentInput): NormalizedWorkbookDocument {
  const template = input.template && TEMPLATE_VALUES.has(input.template) ? input.template : 'workbook'
  const sheets = Array.isArray(input.sheets)
    ? input.sheets.map(normalizeSheet).filter((sheet): sheet is WorkbookSheet => Boolean(sheet)).slice(0, 20)
    : []
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  return {
    title: input.title.trim().slice(0, 160) || 'Generated Workbook',
    filename: input.filename,
    description: input.description,
    template,
    sheets,
    metadata: {
      creator: cleanString(metadata.creator, 160),
      subject: cleanString(metadata.subject, 240),
      company: cleanString(metadata.company, 160),
      currency: cleanString(metadata.currency, 12) || 'USD',
    },
  }
}

export function workbookHasRenderableContent(workbook: NormalizedWorkbookDocument): boolean {
  return workbook.sheets.some(sheet => sheet.tables?.some(table => table.rows.length > 0))
}
