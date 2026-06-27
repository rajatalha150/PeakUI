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
  const name = cleanString(record.name, 240)
  const content = typeof record.content === 'string' ? record.content : ''
  if (!name) return null
  return {
    name,
    mimeType: cleanString(record.mimeType, 160),
    content,
    sourceArtifactId: cleanString(record.sourceArtifactId, 80),
  }
}

export function normalizeArchiveDocumentInput(input: ArchiveDocumentInput): NormalizedArchiveDocument {
  const entries = Array.isArray(input.entries)
    ? input.entries.map(normalizeEntry).filter((e): e is ArchiveDocumentEntry => Boolean(e)).slice(0, 200)
    : []
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