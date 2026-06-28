export interface ArchiveDocumentEntry {
  name: string
  mimeType?: string
  content: string
  sourceArtifactId?: string
}

export interface ArchiveDocumentInput {
  title: string
  filename?: string
  description?: string
  entries: ArchiveDocumentEntry[]
}

export interface NormalizedArchiveDocument {
  title: string
  filename?: string
  description?: string
  entries: ArchiveDocumentEntry[]
}

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

function normalizeEntry(value: unknown): ArchiveDocumentEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  // Accept common aliases for entry fields so a model that used different
  // natural names still produces a valid ZIP entry.
  const name = cleanString(record.name, 240)
    ?? cleanString(record.filename, 240)
    ?? cleanString(record.path, 240)
    ?? cleanString(record.file, 240)
  // Content accepts string or base64; allow `data`/`body`/`text` aliases.
  const contentRaw = (typeof record.content === 'string' && record.content)
    || (typeof record.data === 'string' && record.data)
    || (typeof record.body === 'string' && record.body)
    || (typeof record.text === 'string' && record.text)
    || ''
  if (!name) return null
  if (typeof contentRaw !== 'string' || !contentRaw) return null
  return {
    name,
    mimeType: cleanString(record.mimeType, 160) ?? cleanString(record.type, 160),
    content: contentRaw,
    sourceArtifactId: cleanString(record.sourceArtifactId, 80),
  }
}

export function normalizeArchiveDocumentInput(input: ArchiveDocumentInput): NormalizedArchiveDocument {
  // Accept entries, files, items, or contents at the top level.
  const record = input as unknown as Record<string, unknown>
  const rawEntries = (Array.isArray(input.entries) && input.entries.length
    ? input.entries
    : Array.isArray(record.files) ? record.files
      : Array.isArray(record.items) ? record.items
        : Array.isArray(record.contents) ? record.contents
          : []) as unknown[]
  const entries = rawEntries.map(normalizeEntry).filter((e): e is ArchiveDocumentEntry => Boolean(e)).slice(0, 200)
  return {
    title: (typeof input.title === 'string' ? input.title.trim() : '').slice(0, 200) || 'Untitled Archive',
    filename: cleanString(input.filename, 180),
    description: cleanString(input.description, 800),
    entries,
  }
}

export function archiveDocumentHasRenderableContent(document: NormalizedArchiveDocument): boolean {
  return document.entries.length > 0
}