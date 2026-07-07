import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { formatBytes } from './file-shared'
import { getErrorMessage } from './rag'
import { isSameOllamaModel, normalizeOllamaModelName } from './embedding-models'
import type { FileKind } from './file-shared'
import { detectFileKind, getFileExtension } from './file-shared'
import { prisma } from './prisma'

// ─── Vector constants ─────────────────────────────────────────────────────────

/** Canonical vector width in the database. Shorter embeddings are zero-padded. */
export const RAG_VECTOR_DIMENSIONS = 1536

/**
 * Pad or truncate an embedding vector to the canonical database dimension.
 * Zero-padding preserves cosine similarity because it does not change the
 * magnitude of either vector and adds no dot-product contribution.
 */
export function normalizeVectorDimensions(vector: number[], targetDim = RAG_VECTOR_DIMENSIONS): number[] {
  if (vector.length === targetDim) return vector.slice()
  if (vector.length > targetDim) return vector.slice(0, targetDim)
  const padded = vector.slice()
  while (padded.length < targetDim) padded.push(0)
  return padded
}

/**
 * Convert a normalized embedding array to the PostgreSQL vector literal format
 * used by raw queries: `[a,b,c]`.
 */
export function vectorToPgLiteral(vector: number[]): string {
  return `[${vector.map(v => (Number.isFinite(v) ? v : 0).toString()).join(',')}]`
}

/** Detect whether the connected database supports the `vector` extension. */
export async function isPgvectorEnabled(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`SELECT extname FROM pg_extension WHERE extname = 'vector'`
    return rows.length > 0
  } catch {
    return false
  }
}

// ─── Chunk metadata types ─────────────────────────────────────────────────────

export interface ChunkMetadata {
  /** Human-readable section heading preceding the chunk. */
  section?: string
  /** Page number (for paginated documents such as PDFs / Office). */
  page?: number
  /** Document-level title, if known. */
  title?: string
  /** Short extractive summary of the chunk. */
  summary?: string
  /** Important noun phrases / entities found in the chunk. */
  entities?: string[]
  /** Keywords extracted from the chunk for keyword search boosting. */
  keywords?: string[]
  /** Boundary hints for the chunker (e.g. "heading", "code-block", "table"). */
  boundaries?: string[]
}

export interface ChunkCandidate {
  content: string
  metadata?: ChunkMetadata
}

export interface RagChunkWithMetadata {
  chunkId: string
  chunkIndex: number | null
  documentChunkCount: number
  documentId: string
  filename: string
  sourcePath: string | null
  content: string
  metadata: ChunkMetadata | null
  embedding: string | null
  embeddingModel: string | null
  ragMode: string
  extension: string
  fileKind: FileKind
  documentSize: number
  wholeDocument: boolean
}

export interface RagSearchFilters {
  filename?: string
  folder?: string
  extension?: string
  fileKind?: FileKind | 'all'
  documentId?: string
}

export interface RagSearchResult {
  chunkId: string
  chunkIndex?: number | null
  documentChunkCount?: number | null
  documentId: string
  filename: string
  sourcePath?: string | null
  content: string
  score: number
  rawScore?: number
  mode: 'semantic' | 'keyword' | 'hybrid' | 'unavailable'
  embeddingModel?: string | null
  extension?: string | null
  fileKind?: FileKind | null
  documentSize?: number | null
  excerptChars?: number | null
  wholeDocument?: boolean | null
  metadata?: ChunkMetadata | null
}

export interface KnowledgeBaseContextResult {
  context: string
  sources: RagSearchResult[]
  searched: boolean
  mode: 'semantic' | 'keyword' | 'hybrid' | 'unavailable'
  error?: string
}

export interface KnowledgeBaseContextOptions {
  signal?: AbortSignal
  topK?: number
  keywordTopK?: number
  semanticTopK?: number
  filters?: RagSearchFilters
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

const DEFAULT_TARGET_CHUNK_CHARS = 900
const DEFAULT_MAX_CHUNK_CHARS = 1400
const DEFAULT_CHUNK_OVERLAP_CHARS = 120
const FULL_DOCUMENT_CONTEXT_CHAR_LIMIT = 4000

interface BoundaryChunkerOptions {
  targetChars?: number
  maxChars?: number
  overlapChars?: number
  fullDocumentLimit?: number
}

export function chunkText(text: string, chunkSize = 600, overlap = 80, fullDocumentLimit = FULL_DOCUMENT_CONTEXT_CHAR_LIMIT): string[] {
  return chunkTextByBoundaries(text, {
    targetChars: chunkSize,
    overlapChars: overlap,
    fullDocumentLimit,
  }).map(c => c.content)
}

export function chunkTextByBoundaries(
  text: string,
  options: BoundaryChunkerOptions = {},
): ChunkCandidate[] {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHUNK_CHARS
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS
  const overlapChars = options.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS
  const fullDocumentLimit = options.fullDocumentLimit ?? FULL_DOCUMENT_CONTEXT_CHAR_LIMIT

  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

  if (!normalized) return []
  if (normalized.length <= fullDocumentLimit) {
    return [{ content: normalized }]
  }

  const candidates: ChunkCandidate[] = []
  let start = 0

  while (start < normalized.length) {
    let end = Math.min(start + targetChars, normalized.length)
    if (end < normalized.length) {
      const slice = normalized.slice(start, start + maxChars)
      let bestBreak = -1

      // Prefer paragraph boundaries, then sentence boundaries, then whitespace.
      for (let i = slice.length - 1; i > targetChars * 0.4; i--) {
        const ch = slice[i]
        const prev = slice[i - 1]
        if (ch === '\n' && prev === '\n') {
          bestBreak = i
          break
        }
        if ((ch === '\n' || ch === ' ') && (prev === '.' || prev === '?' || prev === '!' || prev === '：' || prev === '。' || prev === '？' || prev === '！')) {
          if (bestBreak < 0) bestBreak = i
        }
      }

      if (bestBreak > 0) {
        end = start + bestBreak
      }
    }

    const content = normalized.slice(start, end).trim()
    if (content.length > 30) {
      candidates.push({ content })
    }

    // Move forward by targetChars minus an overlap window, then align to the next
    // sentence/paragraph start so we don't repeat mid-sentence text.
    let nextStart = start + Math.max(targetChars - overlapChars, 1)
    if (nextStart < end && nextStart < normalized.length) {
      const lookahead = normalized.slice(nextStart, Math.min(nextStart + overlapChars, normalized.length))
      const boundaryMatch = lookahead.match(/[.?!。！？\n]+\s*/)
      if (boundaryMatch && boundaryMatch.index !== undefined) {
        nextStart += boundaryMatch.index + boundaryMatch[0].length
      }
    }
    start = Math.min(Math.max(nextStart, start + 1), normalized.length)
  }

  return candidates
}

const HEADING_RE = /^#{1,6}\s+(.+)$/m
const CODE_FENCE_RE = /^```[\s\S]*?^```$/gm
const FRONT_MATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n?/

export function chunkMarkdown(text: string, options: BoundaryChunkerOptions = {}): ChunkCandidate[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(FRONT_MATTER_RE, '')
    .trim()

  if (!normalized) return []
  const limit = options.fullDocumentLimit ?? FULL_DOCUMENT_CONTEXT_CHAR_LIMIT
  if (normalized.length <= limit) return [{ content: normalized }]

  const lines = normalized.split('\n')
  const sections: ChunkCandidate[] = []
  let currentHeading = ''
  let buffer: string[] = []
  let bufferChars = 0
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHUNK_CHARS
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS

  function flush(force = false) {
    if (buffer.length === 0) return
    if (!force && bufferChars < targetChars) return
    const content = buffer.join('\n').trim()
    if (content.length > 20) {
      sections.push({
        content,
        metadata: currentHeading ? { section: currentHeading } : undefined,
      })
    }
    buffer = []
    bufferChars = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      flush(true)
      currentHeading = headingMatch[1]?.trim() ?? ''
    }
    buffer.push(line)
    bufferChars += line.length + 1
    if (bufferChars >= maxChars) flush(true)
  }
  flush(true)

  return sections
}

const CODE_BLOCK_RE = /(?:^|\n)(?:\/\/|#|<!--|\/\*|\*\/|\*\s|import\s|from\s|const\s|function\s|class\s|def\s|public\s|private\s|protected\s|interface\s|type\s|struct\s|impl\s|fn\s)/

export function chunkCode(text: string, extension: string, options: BoundaryChunkerOptions = {}): ChunkCandidate[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const limit = options.fullDocumentLimit ?? FULL_DOCUMENT_CONTEXT_CHAR_LIMIT
  if (normalized.length <= limit) return [{ content: normalized }]

  const lines = normalized.split('\n')
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHUNK_CHARS
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS
  const chunks: ChunkCandidate[] = []
  let buffer: string[] = []
  let bufferChars = 0
  let currentFunction = ''

  function functionName(line: string): string | undefined {
    const patterns = [
      /(?:function|def|fn)\s+(\w+)/,
      /(?:class|struct|interface|type|impl)\s+(\w+)/,
      /(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/,
    ]
    for (const re of patterns) {
      const m = line.match(re)
      if (m) return m[1]
    }
    return undefined
  }

  function flush(force = false) {
    if (buffer.length === 0) return
    if (!force && bufferChars < targetChars) return
    const content = buffer.join('\n').trim()
    if (content.length > 20) {
      chunks.push({
        content,
        metadata: currentFunction ? { section: currentFunction } : undefined,
      })
    }
    buffer = []
    bufferChars = 0
  }

  for (const line of lines) {
    const name = functionName(line)
    if (name && bufferChars >= targetChars * 0.5) {
      flush(true)
      currentFunction = name
    }
    buffer.push(line)
    bufferChars += line.length + 1
    if (bufferChars >= maxChars) flush(true)
  }
  flush(true)

  return chunks
}

export function chunkStructuredData(text: string, kind: 'json' | 'yaml' | 'csv' | 'xml', options: BoundaryChunkerOptions = {}): ChunkCandidate[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const limit = options.fullDocumentLimit ?? FULL_DOCUMENT_CONTEXT_CHAR_LIMIT
  if (normalized.length <= limit) return [{ content: normalized }]

  if (kind === 'csv') {
    const lines = normalized.split('\n')
    const header = lines[0] ?? ''
    const chunks: ChunkCandidate[] = []
    const rowsPerChunk = Math.max(1, Math.floor((options.targetChars ?? DEFAULT_TARGET_CHUNK_CHARS) / Math.max(header.length, 1)))
    for (let i = 1; i < lines.length; i += rowsPerChunk) {
      const rows = lines.slice(i, i + rowsPerChunk)
      const content = [header, ...rows].join('\n')
      if (content.length > 20) {
        chunks.push({ content, metadata: { section: `rows ${i}-${Math.min(i + rowsPerChunk - 1, lines.length - 1)}` } })
      }
    }
    return chunks
  }

  // For JSON/YAML/XML fall back to boundary chunking but preserve block indentation.
  return chunkTextByBoundaries(normalized, options)
}

export function chunkDocument(text: string, filename: string, mimeType: string, options: BoundaryChunkerOptions = {}): ChunkCandidate[] {
  const extension = getFileExtension(filename)
  const kind = detectFileKind(filename, mimeType)

  if (kind === 'code' || ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'rb', 'php', 'swift', 'kt'].includes(extension)) {
    return chunkCode(text, extension, options)
  }

  if (extension === 'md' || extension === 'markdown' || mimeType.includes('markdown')) {
    return chunkMarkdown(text, options)
  }

  if (extension === 'json' || extension === 'jsonl' || extension === 'ndjson') {
    return chunkStructuredData(text, 'json', options)
  }

  if (extension === 'yaml' || extension === 'yml') {
    return chunkStructuredData(text, 'yaml', options)
  }

  if (extension === 'csv' || extension === 'tsv') {
    return chunkStructuredData(text, 'csv', options)
  }

  if (extension === 'xml' || extension === 'html' || extension === 'htm') {
    return chunkStructuredData(text, 'xml', options)
  }

  return chunkTextByBoundaries(text, options)
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

const STOPWORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'and', 'but', 'or', 'yet', 'so', 'if', 'because', 'although', 'though',
  'while', 'where', 'when', 'that', 'which', 'who', 'whom', 'whose', 'what', 'this', 'these', 'those',
])

function extractKeywords(text: string, topK = 8): string[] {
  const tokens = tokenize(text)
  const counts = new Map<string, number>()
  for (const t of tokens) {
    if (STOPWORDS_EN.has(t)) continue
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([k]) => k)
}

function extractEntities(text: string): string[] {
  // Cheap rule-based entity extraction: capitalized multi-word phrases.
  const matches = text.match(/\b[A-Z][a-zA-Z]*(?:\s+(?:of|the|in|and|for)\s+)?(?:[A-Z][a-zA-Z]*\b)+/g) ?? []
  return Array.from(new Set(matches.map(m => m.trim()).filter(m => m.length > 2))).slice(0, 8)
}

export function enrichChunkMetadata(chunk: ChunkCandidate, kind: FileKind, index: number, total: number): ChunkMetadata {
  const meta: ChunkMetadata = { ...(chunk.metadata || {}) }
  if (!meta.keywords) meta.keywords = extractKeywords(chunk.content)
  if (!meta.entities) meta.entities = extractEntities(chunk.content)
  if (total > 1 && meta.page === undefined) meta.page = index + 1
  if (!meta.summary) {
    const firstSentence = chunk.content.split(/[.!?](?:\s|$)/)[0]?.trim() ?? ''
    meta.summary = firstSentence.length > 20 && firstSentence.length < 200
      ? firstSentence
      : chunk.content.slice(0, 160).replace(/\n/g, ' ') + '…'
  }
  return meta
}

// ─── Unicode-aware tokenization ─────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().normalize('NFC')
  // Split sequences of letters/numbers, then split trailing digits/versions so
  // 'Python3.12' becomes ['python', '3.12'] and 'hello世界123' stays together.
  const raw = normalized.match(/[\p{L}\p{N}]+(?:[’'_-][\p{L}\p{N}]+)*/gu) ?? []
  const tokens: string[] = []
  for (const token of raw) {
    const parts = token.split(/(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
    for (const part of parts) {
      if (part.length > 1 || /\p{L}/u.test(part)) tokens.push(part)
    }
  }
  return tokens
}

export function normalizeSearchText(value?: string | null): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── DB-level filters ─────────────────────────────────────────────────────────

function buildPrismaDocumentFilterParts(filters?: RagSearchFilters): {
  filenameLike?: string
  extension?: string
  fileKind?: string
  documentId?: string
  folder?: string
} {
  if (!filters) return {}
  return {
    filenameLike: filters.filename,
    extension: filters.extension ? filters.extension.toLowerCase().replace(/^\./, '') : undefined,
    fileKind: filters.fileKind && filters.fileKind !== 'all' ? filters.fileKind : undefined,
    documentId: filters.documentId,
    folder: filters.folder,
  }
}

export function buildPrismaDocumentFilters(filters?: RagSearchFilters): Prisma.DocumentWhereInput {
  const parts = buildPrismaDocumentFilterParts(filters)
  const where: Prisma.DocumentWhereInput = {}

  if (parts.documentId) where.id = parts.documentId
  if (parts.filenameLike) where.filename = { contains: parts.filenameLike, mode: 'insensitive' }
  if (parts.extension) where.filename = { endsWith: `.${parts.extension}`, mode: 'insensitive' }
  if (parts.fileKind) where.kind = parts.fileKind
  if (parts.folder) {
    where.OR = [
      { sourcePath: parts.folder },
      { sourcePath: { startsWith: `${parts.folder}/` } },
    ]
  }

  return where
}

export function matchesRagFilters(chunk: { filename: string; sourcePath?: string | null; fileKind?: FileKind | null; extension?: string | null }, filters?: RagSearchFilters): boolean {
  if (!filters) return true
  if (filters.documentId) return true // handled in DB where

  if (filters.filename && !chunk.filename.toLowerCase().includes(filters.filename.toLowerCase())) return false
  if (filters.folder && !(chunk.sourcePath || '').toLowerCase().includes(filters.folder.toLowerCase())) return false
  if (filters.extension && (chunk.extension || getFileExtension(chunk.filename)).toLowerCase() !== filters.extension.toLowerCase().replace(/^\./, '')) return false
  if (filters.fileKind && filters.fileKind !== 'all' && (chunk.fileKind || detectFileKind(chunk.filename, '')).toLowerCase() !== filters.fileKind.toLowerCase()) return false
  return true
}

// ─── Keyword search (BM25-style, can run in DB or in-memory) ───────────────────

export function keywordSearch(chunks: RagChunkWithMetadata[], query: string, topK: number): RagSearchResult[] {
  const queryTerms = Array.from(new Set(tokenize(query)))
  if (queryTerms.length === 0 || chunks.length === 0) return []

  const docs = chunks.map(chunk => {
    const tokens = tokenize(chunk.content)
    const metadataTokens = [
      ...(chunk.metadata?.keywords ?? []),
      ...(chunk.metadata?.entities ?? []),
      chunk.metadata?.section ?? '',
    ].flatMap(s => tokenize(String(s)))
    const termCounts = new Map<string, number>()
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) ?? 0) + 1)
    }
    for (const token of metadataTokens) {
      // Metadata tokens are lightly boosted because they are usually higher signal.
      termCounts.set(token, (termCounts.get(token) ?? 0) + 1.5)
    }
    return { chunk, tokens, termCounts }
  })

  const docCount = docs.length
  const avgDocLength = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docCount || 1
  const docFrequency = new Map<string, number>()

  for (const term of queryTerms) {
    docFrequency.set(term, docs.filter(doc => doc.termCounts.has(term)).length)
  }

  const k1 = 1.5
  const b = 0.75
  const scored = docs
    .map(doc => {
      const docLength = doc.tokens.length || 1
      let rawScore = 0
      for (const term of queryTerms) {
        const tf = doc.termCounts.get(term) ?? 0
        if (tf === 0) continue
        const df = docFrequency.get(term) ?? 0
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5))
        rawScore += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength))))
      }
      return { doc, rawScore }
    })
    .filter(item => item.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, topK)

  const topScore = scored[0]?.rawScore ?? 1
  return scored.map(item => chunkToResult(item.doc.chunk, item.rawScore / (topScore || 1), 'keyword', item.rawScore))
}

function chunkToResult(chunk: RagChunkWithMetadata, score: number, mode: 'semantic' | 'keyword' | 'hybrid', rawScore?: number): RagSearchResult {
  return {
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    documentChunkCount: chunk.documentChunkCount,
    documentId: chunk.documentId,
    filename: chunk.filename,
    sourcePath: chunk.sourcePath,
    content: chunk.content,
    score,
    rawScore,
    mode,
    embeddingModel: chunk.embeddingModel,
    extension: chunk.extension,
    fileKind: chunk.fileKind,
    documentSize: chunk.documentSize,
    excerptChars: chunk.content.length,
    wholeDocument: chunk.wholeDocument,
    metadata: chunk.metadata,
  }
}

// ─── Semantic search ───────────────────────────────────────────────────────────

export async function semanticSearch(
  queryEmbedding: number[],
  userId: string,
  modelName: string,
  filters: RagSearchFilters | undefined,
  topK: number,
  minScore = 0.2,
): Promise<RagSearchResult[]> {
  const pgvector = await isPgvectorEnabled()
  if (pgvector) {
    const parts = buildPrismaDocumentFilterParts(filters)
    const queryVector = vectorToPgLiteral(normalizeVectorDimensions(queryEmbedding))
    const normalizedModelKey = normalizeOllamaModelName(modelName, modelName).toLowerCase()

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string
      chunkIndex: number
      content: string
      metadata: unknown
      embeddingModel: string | null
      documentId: string
      filename: string
      sourcePath: string | null
      size: number
      kind: string | null
      ragMode: string
      documentChunkCount: bigint
      score: number
    }>>(`
      SELECT
        c."id",
        c."chunkIndex",
        c."content",
        c."metadata",
        d."embeddingModel",
        d."id" AS "documentId",
        d."filename",
        d."sourcePath",
        d."size",
        d."kind",
        d."ragMode",
        COUNT(*) OVER (PARTITION BY d."id") AS "documentChunkCount",
        1 - (c."vector" <=> '${queryVector}'::vector) AS score
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      WHERE d."userId" = '${userId}'
        AND d."status" = 'ready'
        AND d."ragMode" = 'semantic'
        AND c."vector" IS NOT NULL
        AND (d."embeddingModel" IS NULL OR LOWER(d."embeddingModel") = '${normalizedModelKey}')
        ${parts.filenameLike ? `AND d."filename" ILIKE '%${parts.filenameLike.replace(/'/g, "''")}%'` : ''}
        ${parts.extension ? `AND LOWER(d."filename") LIKE '%.${parts.extension.replace(/'/g, "''")}'` : ''}
        ${parts.fileKind ? `AND d."kind" = '${parts.fileKind.replace(/'/g, "''")}'` : ''}
        ${parts.documentId ? `AND d."id" = '${parts.documentId.replace(/'/g, "''")}'` : ''}
      ORDER BY c."vector" <=> '${queryVector}'::vector
      LIMIT ${Math.max(topK * 3, 48)}
    `)

    const results: RagSearchResult[] = []
    for (const row of rows) {
      if (row.score < minScore) continue
      const metadata = parseChunkMetadata(row.metadata)
      results.push({
        chunkId: row.id,
        chunkIndex: row.chunkIndex,
        documentChunkCount: Number(row.documentChunkCount),
        documentId: row.documentId,
        filename: row.filename,
        sourcePath: row.sourcePath,
        content: row.content,
        score: row.score,
        rawScore: row.score,
        mode: 'semantic',
        embeddingModel: row.embeddingModel,
        extension: getFileExtension(row.filename),
        fileKind: (row.kind as FileKind | null) || detectFileKind(row.filename, ''),
        documentSize: row.size,
        excerptChars: row.content.length,
        wholeDocument: Number(row.documentChunkCount) === 1,
        metadata,
      })
    }
    return results.slice(0, topK)
  }

  // Fallback: in-memory JS search when pgvector is unavailable.
  const chunks = await fetchKeywordChunks(userId, filters)
  return semanticSearchInMemory(queryEmbedding, chunks, modelName, topK, minScore)
}

function parseChunkMetadata(value: unknown): ChunkMetadata | null {
  if (!value || typeof value !== 'object') return null
  return value as ChunkMetadata
}

export function semanticSearchInMemory(
  queryEmbedding: number[],
  chunks: RagChunkWithMetadata[],
  modelName: string,
  topK: number,
  minScore = 0.2,
) {
  return chunks
    .filter(c => c.ragMode === 'semantic' && (!c.embeddingModel || isSameOllamaModel(c.embeddingModel, modelName)))
    .map(chunk => {
      const embedding = parseEmbedding(chunk.embedding)
      const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0
      return chunkToResult(chunk, score, 'semantic', score)
    })
    .filter(r => r.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

function parseEmbedding(value: string | null | undefined): number[] | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'number') ? parsed : null
  } catch {
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

async function fetchKeywordChunks(userId: string, filters?: RagSearchFilters): Promise<RagChunkWithMetadata[]> {
  const docWhere = buildPrismaDocumentFilters(filters)
  const chunks = await prisma.documentChunk.findMany({
    where: { document: { userId, status: 'ready', ...docWhere } },
    include: { document: { select: { id: true, filename: true, sourcePath: true, size: true, kind: true, ragMode: true, embeddingModel: true, _count: { select: { chunks: true } } } } },
  })

  return chunks.map(chunk => ({
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    documentChunkCount: chunk.document._count.chunks,
    documentId: chunk.document.id,
    filename: chunk.document.filename,
    sourcePath: chunk.document.sourcePath,
    content: chunk.content,
    metadata: parseChunkMetadata((chunk as unknown as { metadata: unknown }).metadata),
    embedding: (chunk as unknown as { embedding: string | null }).embedding,
    embeddingModel: chunk.document.embeddingModel,
    ragMode: chunk.document.ragMode,
    extension: getFileExtension(chunk.document.filename),
    fileKind: (chunk.document.kind as FileKind | null) || detectFileKind(chunk.document.filename, ''),
    documentSize: chunk.document.size,
    wholeDocument: chunk.document._count.chunks === 1,
  }))
}

// ─── Hybrid fusion ────────────────────────────────────────────────────────────

export function fuseHybrid(
  semanticResults: RagSearchResult[],
  keywordResults: RagSearchResult[],
  topK: number,
): RagSearchResult[] {
  if (semanticResults.length === 0) return keywordResults.slice(0, topK)
  if (keywordResults.length === 0) return semanticResults.slice(0, topK)

  const seen = new Map<string, { score: number; semanticRank: number | null; keywordRank: number | null; result: RagSearchResult }>()

  semanticResults.forEach((result, index) => {
    seen.set(result.chunkId, { score: result.score * 0.6, semanticRank: index + 1, keywordRank: null, result })
  })

  keywordResults.forEach((result, index) => {
    const existing = seen.get(result.chunkId)
    if (existing) {
      existing.keywordRank = index + 1
      // Weighted linear fusion with normalized score magnitudes.
      existing.score = Math.max(existing.score, result.score * 0.4)
    } else {
      seen.set(result.chunkId, { score: result.score * 0.4, semanticRank: null, keywordRank: index + 1, result })
    }
  })

  // Reciprocal rank fusion as a secondary signal for ranking stability.
  const k = 60
  const fused = Array.from(seen.values())
    .map(item => {
      const rrfSemantic = item.semanticRank ? 1.0 / (k + item.semanticRank) : 0
      const rrfKeyword = item.keywordRank ? 0.7 / (k + item.keywordRank) : 0
      return { ...item, score: item.score + rrfSemantic + rrfKeyword }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => ({ ...item.result, score: Math.min(1, Math.max(0, item.score)) }))

  return fused
}

// ─── MMR (Maximal Marginal Relevance) ─────────────────────────────────────────

export function applyMMR(results: RagSearchResult[], queryEmbedding: number[], topK: number, lambda = 0.5): RagSearchResult[] {
  if (results.length <= topK) return results
  if (!queryEmbedding.length) return results.slice(0, topK)

  const candidates = results.map(r => ({ result: r, embedding: parseEmbedding(r.content) || [] }))
  const selected: typeof candidates = []
  const remaining = [...candidates]

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = -1
    let bestScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const relevance = candidate.embedding.length
        ? cosineSimilarity(queryEmbedding, candidate.embedding)
        : candidate.result.score
      let maxSimilarity = 0
      for (const sel of selected) {
        if (!candidate.embedding.length || !sel.embedding.length) continue
        maxSimilarity = Math.max(maxSimilarity, cosineSimilarity(candidate.embedding, sel.embedding))
      }
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity
      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIndex = i
      }
    }

    if (bestIndex < 0) break
    selected.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }

  return selected.map(s => s.result)
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const tokensA = new Set(tokenize(a))
  const tokensB = new Set(tokenize(b))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)))
  return intersection.size / (tokensA.size + tokensB.size - intersection.size)
}

export function deduplicateResults(results: RagSearchResult[], threshold = 0.92): RagSearchResult[] {
  const unique: RagSearchResult[] = []
  for (const candidate of results) {
    // Prefer exact chunk identity first; then fall back to content similarity.
    const exactDuplicate = unique.find(existing => existing.chunkId === candidate.chunkId)
    if (exactDuplicate) {
      if ((candidate.rawScore ?? candidate.score ?? 0) > (exactDuplicate.rawScore ?? exactDuplicate.score ?? 0)) {
        const index = unique.indexOf(exactDuplicate)
        unique[index] = candidate
      }
      continue
    }

    let duplicate = false
    for (const existing of unique) {
      if (jaccardSimilarity(candidate.content, existing.content) >= threshold) {
        duplicate = true
        break
      }
    }
    if (!duplicate) unique.push(candidate)
  }
  return unique
}

// ─── Context block builder ────────────────────────────────────────────────────

const MAX_SOURCE_EXCERPT_CHARS = 2500
const MAX_CONTEXT_CHARS = 10000
const MAX_CONTEXT_CHARS_FULL_ACCESS = 100000

export function buildKnowledgeBaseRetrievalContract(): string {
  return [
    'IMPORTANT: You have access to the user\'s knowledge base. You MUST use this context to answer their question — prioritize information from these sources over your training data when they are relevant.',
    'Each numbered entry is source context from an indexed document. If an entry says "full document", treat it as the complete file.',
    'If the context is not enough, ask for a broader lookup or direct file inspection by naming the file, folder, or chunk you want.',
    'Use query directives like file:, folder:, type:, or ext: when you need a narrower KB lookup.',
    'Always cite the source number and chunk number when referencing knowledge base content.',
  ].join(' ')
}

function buildSourceHeader(source: RagSearchResult, index: number, excerptChars: number): string {
  const metadata = [
    source.fileKind || 'document',
    source.extension ? `.${source.extension}` : null,
    source.metadata?.section,
    typeof source.documentSize === 'number' ? formatBytes(source.documentSize) : null,
    source.wholeDocument
      ? `full document ${excerptChars.toLocaleString()} chars`
      : typeof source.chunkIndex === 'number'
        ? typeof source.documentChunkCount === 'number'
          ? `chunk ${source.chunkIndex + 1}/${source.documentChunkCount}`
          : `chunk ${source.chunkIndex + 1}`
        : null,
    source.wholeDocument ? null : `excerpt ${excerptChars.toLocaleString()} chars`,
    `${Math.round((source.score || 0) * 100)}% match`,
    source.mode || 'semantic',
  ].filter(Boolean).join(' · ')

  return `[${index + 1}] ${source.filename} · ${metadata}`
}

export function buildRagContextBlock(query: string, results: RagSearchResult[], mode: string, fullAccess = false): string {
  if (results.length === 0) return ''

  const sections = results.map((source, index) => {
    const content = source.wholeDocument || source.content.length <= MAX_SOURCE_EXCERPT_CHARS
      ? source.content
      : `${source.content.slice(0, MAX_SOURCE_EXCERPT_CHARS)}…`
    const excerptChars = source.wholeDocument ? source.content.length : Math.min(source.content.length, MAX_SOURCE_EXCERPT_CHARS)
    const sourceRef = source.sourcePath && source.sourcePath !== source.filename
      ? `${source.filename} (${source.sourcePath})`
      : source.filename
    const header = buildSourceHeader({ ...source, filename: sourceRef }, index, excerptChars)
    return [header, content].join('\n')
  })

  const intro = mode === 'hybrid'
    ? `KNOWLEDGE BASE (Hybrid Search — Semantic + Keyword):\n${buildKnowledgeBaseRetrievalContract()}\nSearching across your indexed documents for: "${query}"`
    : `KNOWLEDGE BASE (${mode === 'semantic' ? 'Semantic' : 'Keyword'} Search):\n${buildKnowledgeBaseRetrievalContract()}\nSearching across your indexed documents for: "${query}"`

  const full = [intro, ...sections].join('\n\n')
  const limit = fullAccess ? MAX_CONTEXT_CHARS_FULL_ACCESS : MAX_CONTEXT_CHARS

  if (full.length <= limit) return full

  // Truncate at section boundaries: drop the lowest-ranked tail sections whole.
  const introLength = intro.length
  const available = limit - introLength - 3
  let used = 0
  const keptSections: string[] = []
  for (const section of sections) {
    if (used + section.length + 2 <= available) {
      keptSections.push(section)
      used += section.length + 2
    } else {
      break
    }
  }
  return `${intro}\n\n${keptSections.join('\n\n')}…`
}

// Re-export getErrorMessage so callers only need one import path.
export { getErrorMessage }

export function parseRagQueryFilters(input: string): { query: string; filters?: RagSearchFilters } {
  const filters: RagSearchFilters = {}
  let remaining = input

  const directiveRe = /\b(file|filename|folder|path|type|kind|ext|extension):(?:"([^"]+)"|([^\s]+))/gi

  remaining = remaining.replace(directiveRe, (_match, rawKey: string, quotedValue: string | undefined, bareValue: string | undefined) => {
    const value = (quotedValue || bareValue || '').trim()
    if (!value) return ' '

    switch (rawKey.toLowerCase()) {
      case 'file':
      case 'filename':
        filters.filename = value
        break
      case 'folder':
      case 'path':
        filters.folder = value
        break
      case 'type':
      case 'kind': {
        const normalized = value.toLowerCase()
        if (normalized === 'all') break
        filters.fileKind = [
          'image', 'document', 'text', 'code', 'data', 'archive', 'audio', 'video', 'binary',
        ].includes(normalized)
          ? normalized as FileKind
          : undefined
        if (!filters.fileKind) filters.extension = normalized.replace(/^\./, '')
        break
      }
      case 'ext':
      case 'extension':
        filters.extension = value.toLowerCase().replace(/^\./, '')
        break
    }
    return ' '
  })

  const query = remaining.replace(/\s{2,}/g, ' ').trim()
  return Object.values(filters).some(Boolean) ? { query, filters } : { query: input.trim() }
}

function mergeRagFilters(primary?: RagSearchFilters, secondary?: RagSearchFilters): RagSearchFilters | undefined {
  const merged: RagSearchFilters = {
    filename: primary?.filename || secondary?.filename,
    folder: primary?.folder || secondary?.folder,
    extension: primary?.extension || secondary?.extension,
    fileKind: primary?.fileKind || secondary?.fileKind,
    documentId: primary?.documentId || secondary?.documentId,
  }
  return Object.values(merged).some(Boolean) ? merged : undefined
}

export async function buildKnowledgeBaseContext(
  query: string,
  userId: string,
  options: KnowledgeBaseContextOptions = {},
): Promise<KnowledgeBaseContextResult> {
  const parsedQuery = parseRagQueryFilters(query)
  const filters = mergeRagFilters(options.filters, parsedQuery.filters)
  const effectiveQuery = parsedQuery.query || [
    filters?.filename,
    filters?.folder,
    filters?.extension,
    filters?.fileKind && filters.fileKind !== 'all' ? filters.fileKind : null,
  ].filter(Boolean).join(' ') || query.trim()

  const isFullAccess = options.topK === -1
  const effectiveTopK = isFullAccess ? 10000 : (options.topK ?? 8)
  const effectiveKeywordTopK = isFullAccess ? 10000 : (options.keywordTopK ?? Math.round(effectiveTopK * 1.5))
  const effectiveSemanticTopK = isFullAccess ? 10000 : (options.semanticTopK ?? Math.round(effectiveTopK * 1.5))
  const { signal } = options

  try {
    const docCount = await prisma.document.count({ where: { userId, status: 'ready' } })
    if (docCount === 0) {
      return { context: '', sources: [], searched: false, mode: 'unavailable' }
    }

    const { getEmbedding } = await import('./rag')
    const { getUserSettings } = await import('./settings')
    const settings = await getUserSettings(userId)

    const keywordChunks = await fetchKeywordChunks(userId, filters)
    if (keywordChunks.length === 0) {
      return { context: '', sources: [], searched: false, mode: 'unavailable' }
    }

    const keywordResults = keywordSearch(keywordChunks, effectiveQuery, effectiveKeywordTopK)

    const hasSemanticChunks = keywordChunks.some(c => c.ragMode === 'semantic' && c.embeddingModel && isSameOllamaModel(c.embeddingModel, settings.ragModel))

    if (!hasSemanticChunks || settings.ragMode === 'keyword') {
      const deduped = deduplicateResults(keywordResults)
      return {
        context: buildRagContextBlock(effectiveQuery, deduped, 'keyword', isFullAccess),
        sources: deduped,
        searched: true,
        mode: 'keyword',
      }
    }

    let semanticResults: RagSearchResult[] = []
    try {
      const queryEmbedding = await getEmbedding(effectiveQuery, settings.ragModel, settings.ollamaHost, settings.ollamaApiKey, 20000)
      semanticResults = await semanticSearch(queryEmbedding, userId, settings.ragModel, filters, effectiveSemanticTopK)
    } catch (semanticError) {
      console.warn('KB semantic search failed, using keyword only:', semanticError)
      const deduped = deduplicateResults(keywordResults)
      return {
        context: buildRagContextBlock(effectiveQuery, deduped, 'keyword', isFullAccess),
        sources: deduped,
        searched: true,
        mode: 'keyword',
        error: String(semanticError),
      }
    }

    const fused = fuseHybrid(semanticResults, keywordResults, effectiveTopK * 2)
    const reranked = applyMMR(fused, (await getEmbedding(effectiveQuery, settings.ragModel, settings.ollamaHost, settings.ollamaApiKey, 20000)), effectiveTopK)
    const deduped = deduplicateResults(reranked)

    return {
      context: buildRagContextBlock(effectiveQuery, deduped, 'hybrid', isFullAccess),
      sources: deduped,
      searched: true,
      mode: deduped.some(r => r.mode === 'semantic') ? 'hybrid' : 'keyword',
    }
  } catch (error) {
    if (signal?.aborted) throw error
    console.error('Knowledge base context build failed:', error)
 return {
      context: '',
      sources: [],
      searched: false,
      mode: 'unavailable',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function augmentMessagesWithKnowledgeBase(
  options: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content?: string; images?: string[] }>
    knowledgeQuery?: string
    signal?: AbortSignal
    ragEnabled?: boolean
    topK?: number
    filters?: RagSearchFilters
  },
  userId: string,
): Promise<{ messages: typeof options.messages; knowledgeSources: RagSearchResult[] }> {
  if (!options.ragEnabled) {
    return { messages: options.messages, knowledgeSources: [] }
  }

  const query = options.knowledgeQuery?.trim() || findLatestUserQuery(options.messages)
  if (!query) return { messages: options.messages, knowledgeSources: [] }

  const result = await buildKnowledgeBaseContext(query, userId, {
    signal: options.signal,
    topK: options.topK ?? 8,
    filters: options.filters,
  })

  if (!result.searched || result.sources.length === 0) {
    return { messages: options.messages, knowledgeSources: [] }
  }

  return {
    messages: [{ role: 'system', content: result.context }, ...options.messages],
    knowledgeSources: result.sources,
  }
}

function findLatestUserQuery(messages: Array<{ role: 'user' | 'assistant' | 'system'; content?: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.content?.trim()) return msg.content.trim()
  }
  return ''
}

// ─── Indexing helpers ──────────────────────────────────────────────────────────

export interface IndexDocumentResult {
  documentId: string
  chunkCount: number
  mode: 'semantic' | 'keyword'
  error?: string
}

export async function indexDocumentChunks(
  documentId: string,
  text: string,
  filename: string,
  mimeType: string,
  settings: { ragModel: string; ragMode: 'semantic' | 'keyword'; ollamaHost: string; ollamaApiKey: string },
): Promise<IndexDocumentResult> {
  const candidates = chunkDocument(text, filename, mimeType)
  const chunks = candidates.map((c, i, arr) => ({
    ...c,
    metadata: enrichChunkMetadata(c, detectFileKind(filename, mimeType), i, arr.length),
  }))

  let embeddings: number[][] = []
  let mode: 'semantic' | 'keyword' = settings.ragMode

  if (mode === 'semantic') {
    try {
      const { getEmbeddings } = await import('./rag')
      embeddings = await getEmbeddings(chunks.map(c => c.content), settings.ragModel, settings.ollamaHost, settings.ollamaApiKey, 120000)
    } catch (error) {
      mode = 'keyword'
      console.warn(`Semantic embedding failed for ${filename}; falling back to keyword indexing:`, error)
    }
  }

  const embeddingDim = embeddings[0]?.length ?? 0

  const pgvector = await isPgvectorEnabled()


  await prisma.$transaction(async tx => {
    await tx.documentChunk.deleteMany({ where: { documentId } })

    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100)

      const rows = batch.map((chunk, offset) => {
        const embedding = mode === 'semantic' ? embeddings[i + offset] : null
        const index = i + offset
        const metadataValue = chunk.metadata ? JSON.stringify(chunk.metadata) : 'null'
        return {
          chunkIndex: index,
          content: chunk.content,
          embedding: embedding ? JSON.stringify(embedding) : null,
          metadata: chunk.metadata as Prisma.InputJsonValue,
          documentId,
          vector: embedding ? vectorToPgLiteral(normalizeVectorDimensions(embedding)) : null,
          metadataLiteral: metadataValue,
        }
      })

      if (pgvector) {
        // Prisma Client cannot write Unsupported("vector") via createMany.
        const values = rows.map(row => `('${randomUUID()}', ${row.chunkIndex}, '${row.content.replace(/'/g, "''")}', ${row.embedding ? `'${row.embedding.replace(/'/g, "''")}'` : 'NULL'}, ${row.metadataLiteral === 'null' ? 'NULL' : `'${row.metadataLiteral.replace(/'/g, "''")}'::jsonb`}, '${row.documentId}', ${row.vector ? `'${row.vector}'::vector` : 'NULL'})`).join(',\n')
        await tx.$executeRawUnsafe(`
          INSERT INTO "DocumentChunk" ("id", "chunkIndex", "content", "embedding", "metadata", "documentId", "vector")
          VALUES ${values}
        `)
      } else {
        await tx.documentChunk.createMany({
          data: rows.map(row => ({
            chunkIndex: row.chunkIndex,
            content: row.content,
            embedding: row.embedding,
            metadata: row.metadata,
            documentId: row.documentId,
          })),
        })
      }

    }

    await tx.document.update({
      where: { id: documentId },
      data: {
        status: 'ready',
        ragMode: mode,
        embeddingModel: mode === 'semantic' ? settings.ragModel : null,
        embeddingDimensions: mode === 'semantic' ? embeddingDim : null,
        ollamaHost: mode === 'semantic' ? settings.ollamaHost : null,
        indexedAt: new Date(),
        errorMessage: mode === 'keyword' && settings.ragMode === 'semantic'
          ? `Semantic embedding failed; indexed with keyword search fallback. Check that "${settings.ragModel}" is available at ${settings.ollamaHost}.`
          : null,
      },
    })
  })

  return { documentId, chunkCount: chunks.length, mode }
}
