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
