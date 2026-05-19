import type { FileKind } from './file-shared'

export type MessageSourceMode = 'semantic' | 'keyword' | 'web'

export interface MessageSource {
  chunkId?: string
  chunkIndex?: number | null
  documentChunkCount?: number | null
  documentId?: string
  filename: string
  sourcePath?: string | null
  content: string
  score: number
  mode?: MessageSourceMode
  embeddingModel?: string | null
  url?: string
  title?: string
  excerpt?: string
  extension?: string | null
  fileKind?: FileKind | null
  documentSize?: number | null
  excerptChars?: number | null
  wholeDocument?: boolean | null
  networkMode?: 'direct' | 'stealth'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return normalizeString(value)
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeNullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  return normalizeFiniteNumber(value)
}

export function normalizeMessageSource(value: unknown): MessageSource | null {
  if (!isRecord(value)) return null

  const title = normalizeString(value.title)
  const url = normalizeString(value.url)
  const excerpt = normalizeString(value.excerpt)
  const filename = normalizeString(value.filename) || title || url
  const content = normalizeString(value.content) || excerpt || title || url || ''
  if (!filename || !content) return null

  const normalized: MessageSource = {
    filename,
    content,
    score: normalizeFiniteNumber(value.score) ?? 0,
  }

  const chunkId = normalizeString(value.chunkId)
  if (chunkId) normalized.chunkId = chunkId

  const chunkIndex = normalizeNullableFiniteNumber(value.chunkIndex)
  if (chunkIndex !== undefined) normalized.chunkIndex = chunkIndex

  const documentChunkCount = normalizeNullableFiniteNumber(value.documentChunkCount)
  if (documentChunkCount !== undefined) normalized.documentChunkCount = documentChunkCount

  const documentId = normalizeString(value.documentId)
  if (documentId) normalized.documentId = documentId

  const sourcePath = normalizeNullableString(value.sourcePath)
  if (sourcePath !== undefined) normalized.sourcePath = sourcePath

  const mode = value.mode === 'semantic' || value.mode === 'keyword' || value.mode === 'web'
    ? value.mode
    : undefined
  if (mode) normalized.mode = mode

  const embeddingModel = normalizeNullableString(value.embeddingModel)
  if (embeddingModel !== undefined) normalized.embeddingModel = embeddingModel

  if (url) normalized.url = url
  if (title) normalized.title = title
  if (excerpt) normalized.excerpt = excerpt

  const extension = normalizeNullableString(value.extension)
  if (extension !== undefined) normalized.extension = extension

  const fileKind = normalizeNullableString(value.fileKind)
  if (fileKind !== undefined) normalized.fileKind = fileKind as FileKind | null

  const documentSize = normalizeNullableFiniteNumber(value.documentSize)
  if (documentSize !== undefined) normalized.documentSize = documentSize

  const excerptChars = normalizeNullableFiniteNumber(value.excerptChars)
  if (excerptChars !== undefined) normalized.excerptChars = excerptChars

  if (typeof value.wholeDocument === 'boolean') normalized.wholeDocument = value.wholeDocument

  if (value.networkMode === 'direct' || value.networkMode === 'stealth') {
    normalized.networkMode = value.networkMode
  }

  return normalized
}

export function normalizeMessageSources(value: unknown): MessageSource[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(source => {
    const normalized = normalizeMessageSource(source)
    return normalized ? [normalized] : []
  })
}

function getSourceKey(source: MessageSource): string {
  if (source.url) return `url:${source.url}`
  if (source.chunkId) return `chunk:${source.chunkId}`
  return `${source.mode || 'unknown'}:${source.filename}`
}

function getSourceWeight(source: MessageSource): number {
  const textLength = (source.excerpt || source.content || '').length
  const titleWeight = source.title ? 50 : 0
  const urlWeight = source.url ? 25 : 0
  return textLength + titleWeight + urlWeight
}

export function mergeMessageSources(existing: MessageSource[], incoming: MessageSource[], maxSources = 8): MessageSource[] {
  const merged = [...existing]
  const indexByKey = new Map<string, number>()

  merged.forEach((source, index) => {
    indexByKey.set(getSourceKey(source), index)
  })

  for (const candidate of incoming) {
    const key = getSourceKey(candidate)
    const existingIndex = indexByKey.get(key)

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length)
      merged.push(candidate)
      continue
    }

    const current = merged[existingIndex]
    if (getSourceWeight(candidate) >= getSourceWeight(current)) {
      merged[existingIndex] = candidate
    }
  }

  return merged.slice(0, maxSources)
}
