export interface CsvRow {
  [column: string]: string | number | boolean | null | undefined
}

export interface CsvDocumentInput {
  title: string
  filename?: string
  description?: string
  headers?: string[]
  rows?: CsvRow[]
  /** Raw CSV content. If provided, headers/rows are ignored. */
  content?: string
}

export interface NormalizedCsvDocument {
  title: string
  filename?: string
  description?: string
  content: string
}

const MAX_CSV_CHARS = 500_000

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const needsQuotes = /[",\n\r]/.test(text)
  const escaped = text.replace(/"/g, '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

export function normalizeCsvDocumentInput(input: CsvDocumentInput): NormalizedCsvDocument {
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 160) : 'Generated CSV'
  let content = ''

  if (typeof input.content === 'string' && input.content.trim()) {
    content = input.content.trim()
  } else {
    const headers = Array.isArray(input.headers)
      ? input.headers.map(h => String(h ?? '').trim()).filter(Boolean).slice(0, 120)
      : []

    const rows: CsvRow[] = []
    if (Array.isArray(input.rows)) {
      for (const row of input.rows) {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          rows.push(row)
        }
      }
    }

    if (headers.length > 0) {
      const lines = [headers.map(escapeCsvCell).join(',')]
      for (const row of rows.slice(0, 50_000)) {
        lines.push(headers.map(header => escapeCsvCell(row[header])).join(','))
      }
      content = lines.join('\n')
    } else if (rows.length > 0) {
      // Infer headers from first row keys
      const inferredHeaders = Object.keys(rows[0]).slice(0, 120)
      const lines = [inferredHeaders.map(escapeCsvCell).join(',')]
      for (const row of rows.slice(0, 50_000)) {
        lines.push(inferredHeaders.map(header => escapeCsvCell(row[header])).join(','))
      }
      content = lines.join('\n')
    }
  }

  return {
    title,
    filename: typeof input.filename === 'string' && input.filename.trim()
      ? input.filename.trim().slice(0, 180)
      : undefined,
    description: typeof input.description === 'string' && input.description.trim()
      ? input.description.trim().slice(0, 400)
      : undefined,
    content: content.slice(0, MAX_CSV_CHARS),
  }
}

export function csvDocumentHasRenderableContent(document: NormalizedCsvDocument): boolean {
  return document.content.trim().length > 0
}
