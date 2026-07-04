import { normalizeOllamaModelName } from './embedding-models'
import type { MessageSource } from './message-sources'
import type { RagMode } from './settings'
import { detectFileKind, formatBytes, getFileExtension, type FileKind } from './file-shared'

export interface RagChunkForSearch {
  chunkId: string
  chunkIndex?: number | null
  documentChunkCount?: number | null
  documentId: string
  filename: string
  sourcePath?: string | null
  content: string
  embedding?: string | null
  embeddingModel?: string | null
  ragMode?: string | null
  extension?: string | null
  fileKind?: FileKind | null
  documentSize?: number | null
  excerptChars?: number | null
  wholeDocument?: boolean | null
}

export interface RagSearchFilters {
  filename?: string
  folder?: string
  extension?: string
  fileKind?: FileKind | 'all'
  documentId?: string
}

export interface RagSearchResult extends MessageSource {
  chunkId: string
  chunkIndex?: number | null
  documentId: string
  rawScore?: number
  mode: RagMode
}

interface EmbedResponse {
  embedding?: number[]
  embeddings?: number[][]
}

const DEFAULT_EMBED_TIMEOUT_MS = 120000
const MAX_SOURCE_EXCERPT_CHARS = 2500
const MAX_CONTEXT_CHARS = 10000
const MAX_CONTEXT_CHARS_FULL_ACCESS = 100000
export const FULL_DOCUMENT_CONTEXT_CHAR_LIMIT = 4000

export function getErrorMessage(error: unknown, fallback = 'Internal server error'): string {
  return error instanceof Error ? error.message : fallback
}

export function chunkText(text: string, chunkSize = 600, overlap = 80, fullDocumentLimit = FULL_DOCUMENT_CONTEXT_CHAR_LIMIT): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return []
  if (normalized.length <= fullDocumentLimit) return [normalized]

  const chunks: string[] = []
  let start = 0

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length)
    let slice = normalized.slice(start, end)

    if (end < normalized.length) {
      const lastBreak = Math.max(
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('! ')
      )
      if (lastBreak > chunkSize * 0.4) {
        slice = normalized.slice(start, start + lastBreak + 1)
      }
    }

    const trimmed = slice.trim()
    if (trimmed.length > 30) chunks.push(trimmed)
    start += Math.max(slice.length - overlap, 1)
  }

  return chunks
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || error.message.toLowerCase().includes('timeout'))
}

async function postEmbed(ollamaHost: string, body: Record<string, unknown>, timeoutMs: number, apiKey: string, legacy = false): Promise<EmbedResponse> {
  const endpoint = legacy ? '/api/embeddings' : '/api/embed'
  const res = await fetch(`${ollamaHost}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey.trim() ? { Authorization: 'Bearer ' + apiKey.trim() } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    const errText = await res.text()
    const error = new Error(`Embedding model error: ${res.status} ${errText}`)
    ;(error as Error & { status?: number }).status = res.status
    throw error
  }

  return await res.json() as EmbedResponse
}

function normalizeEmbedResponse(data: EmbedResponse): number[][] {
  if (data.embeddings?.length) return data.embeddings
  if (data.embedding?.length) return [data.embedding]
  return []
}

export async function getEmbeddings(input: string | string[], model: string, ollamaHost: string, apiKey: string, timeoutMs = DEFAULT_EMBED_TIMEOUT_MS): Promise<number[][]> {
  const normalizedModel = normalizeOllamaModelName(model, model)
  const values = Array.isArray(input) ? input : [input]

  try {
    const data = await postEmbed(ollamaHost, {
      model: normalizedModel,
      input: values.length === 1 ? values[0] : values,
      truncate: true,
    }, timeoutMs, apiKey)

    const embeddings = normalizeEmbedResponse(data)
    if (embeddings.length !== values.length) {
      throw new Error(`Expected ${values.length} embeddings from Ollama, received ${embeddings.length}`)
    }

    return embeddings
  } catch (error) {
    const status = (error as Error & { status?: number }).status

    if ((status === 404 || status === 405) && values.length === 1) {
      try {
        const legacyData = await postEmbed(ollamaHost, {
          model: normalizedModel,
          prompt: values[0],
        }, timeoutMs, apiKey, true)
        const embeddings = normalizeEmbedResponse(legacyData)
        if (embeddings.length) return embeddings
      } catch (legacyError) {
        if (isTimeoutError(legacyError)) {
          throw new Error(`Embedding request for "${normalizedModel}" timed out after ${Math.round(timeoutMs / 1000)}s. Ollama may still be loading the model; try again or check "ollama ps".`)
        }
        throw legacyError
      }
    }

    if (isTimeoutError(error)) {
      throw new Error(`Embedding request for "${normalizedModel}" timed out after ${Math.round(timeoutMs / 1000)}s. Ollama may still be loading the model; try again or check "ollama ps".`)
    }

    throw error
  }
}

export async function getEmbedding(text: string, model: string, ollamaHost: string, apiKey: string, timeoutMs = DEFAULT_EMBED_TIMEOUT_MS): Promise<number[]> {
  const embeddings = await getEmbeddings(text, model, ollamaHost, apiKey, timeoutMs)
  if (!embeddings[0]) {
    throw new Error('No embeddings returned from Ollama')
  }

  return embeddings[0]
}

export function cosineSimilarity(a: number[], b: number[]): number {
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

export function parseEmbedding(value: string | null | undefined): number[] | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'number') ? parsed : null
  } catch {
    return null
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? []
}

function normalizeSearchText(value?: string | null): string {
  return value?.trim().toLowerCase() ?? ''
}

export function matchesRagFilters(chunk: RagChunkForSearch, filters?: RagSearchFilters): boolean {
  if (!filters) return true

  if (filters.documentId && chunk.documentId !== filters.documentId) return false

  const normalizedFilename = normalizeSearchText(filters.filename)
  if (normalizedFilename && !chunk.filename.toLowerCase().includes(normalizedFilename)) {
    return false
  }

  const normalizedFolder = normalizeSearchText(filters.folder)
  if (normalizedFolder) {
    const sourcePath = (chunk.sourcePath || '').toLowerCase()
    if (!sourcePath.includes(normalizedFolder)) return false
  }

  const normalizedExtension = normalizeSearchText(filters.extension)
  if (normalizedExtension) {
    const extension = (chunk.extension || getFileExtension(chunk.filename)).toLowerCase()
    if (extension !== normalizedExtension) return false
  }

  if (filters.fileKind && filters.fileKind !== 'all') {
    if ((chunk.fileKind || detectFileKind(chunk.filename, '')).toLowerCase() !== filters.fileKind.toLowerCase()) {
      return false
    }
  }

  return true
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

export function buildKnowledgeBaseRetrievalContract(): string {
  return [
    'IMPORTANT: You have access to the user\'s knowledge base. You MUST use this context to answer their question — prioritize information from these sources over your training data when they are relevant.',
    'Each numbered entry is source context from an indexed document. If an entry says "full document", treat it as the complete file.',
    'If the context is not enough, ask for a broader lookup or direct file inspection by naming the file, folder, or chunk you want.',
    'Use query directives like file:, folder:, type:, or ext: when you need a narrower KB lookup.',
    'Always cite the source number and chunk number when referencing knowledge base content.',
  ].join(' ')
}

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
        if (!filters.fileKind) {
          filters.extension = normalized.replace(/^\./, '')
        }
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

export function keywordSearch(chunks: RagChunkForSearch[], query: string, topK: number): RagSearchResult[] {
  const queryTerms = Array.from(new Set(tokenize(query)))
  if (queryTerms.length === 0 || chunks.length === 0) return []

  const docs = chunks.map(chunk => {
    const tokens = tokenize(chunk.content)
    const termCounts = new Map<string, number>()
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) ?? 0) + 1)
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
    .sort((a, bScore) => bScore.rawScore - a.rawScore)
    .slice(0, topK)

  const topScore = scored[0]?.rawScore ?? 1

  return scored.map(item => ({
    chunkId: item.doc.chunk.chunkId,
    chunkIndex: item.doc.chunk.chunkIndex,
    documentChunkCount: item.doc.chunk.documentChunkCount,
    documentId: item.doc.chunk.documentId,
    filename: item.doc.chunk.filename,
    sourcePath: item.doc.chunk.sourcePath,
    content: item.doc.chunk.content,
    score: topScore > 0 ? item.rawScore / topScore : 0,
    rawScore: item.rawScore,
    mode: 'keyword',
    embeddingModel: item.doc.chunk.embeddingModel,
    extension: item.doc.chunk.extension,
    fileKind: item.doc.chunk.fileKind,
    documentSize: item.doc.chunk.documentSize,
    excerptChars: item.doc.chunk.excerptChars ?? item.doc.chunk.content.length,
    wholeDocument: item.doc.chunk.wholeDocument,
  }))
}

// ─── Knowledge Base Context Builder ───────────────────────────────────────────

export interface KnowledgeBaseContextOptions {
  signal?: AbortSignal
  topK?: number
  keywordTopK?: number
  semanticTopK?: number
  filters?: RagSearchFilters
}

export interface KnowledgeBaseContextResult {
  context: string
  sources: RagSearchResult[]
  searched: boolean
  mode: RagMode | 'hybrid' | 'unavailable'
  error?: string
}

/**
 * Build a knowledge base context block by querying the user's indexed documents.
 * Uses Reciprocal Rank Fusion (RRF) to combine semantic + keyword results when both modes exist.
 */
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
  const isFullAccess = options.topK === -1;
  // For full access, retrieve a large number of chunks from each search
  const effectiveTopK = isFullAccess ? 10000 : (options.topK ?? 8);
  const effectiveKeywordTopK = isFullAccess ? 10000 : (options.keywordTopK ?? Math.round(effectiveTopK * 1.5));
  const effectiveSemanticTopK = isFullAccess ? 10000 : (options.semanticTopK ?? Math.round(effectiveTopK * 1.5));
  const { signal } = options

  try {
    const { prisma } = await import('@/lib/prisma')

    const docCount = await prisma.document.count({
      where: { userId, status: 'ready' },
    })

    if (docCount === 0) {
      return { context: '', sources: [], searched: false, mode: 'unavailable' }
    }

    // Fetch all chunks — for small corpora this is fine; for larger ones you'd paginate
    const chunks = await prisma.documentChunk.findMany({
      where: { document: { userId, status: 'ready' } },
      include: {
        document: {
          select: {
            id: true,
            filename: true,
            sourcePath: true,
            size: true,
            kind: true,
            ragMode: true,
            embeddingModel: true,
            _count: { select: { chunks: true } },
          },
        },
      },
    })

    if (chunks.length === 0) {
      return { context: '', sources: [], searched: false, mode: 'unavailable' }
    }

    const keywordChunks: RagChunkForSearch[] = chunks.map(chunk => ({
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      documentChunkCount: chunk.document._count.chunks,
      documentId: chunk.document.id,
      filename: chunk.document.filename,
      sourcePath: chunk.document.sourcePath,
      content: chunk.content,
      embedding: chunk.embedding,
      embeddingModel: chunk.document.embeddingModel,
      ragMode: chunk.document.ragMode,
      extension: getFileExtension(chunk.document.filename),
      fileKind: (chunk.document.kind as FileKind | null | undefined) || detectFileKind(chunk.document.filename, ''),
      documentSize: chunk.document.size,
      excerptChars: chunk.content.length,
      wholeDocument: chunk.document._count.chunks === 1,
    }))
      .filter(chunk => matchesRagFilters(chunk, filters))

    // Check what's available
    const hasSemanticChunks = keywordChunks.some(c => c.embedding && c.ragMode === 'semantic')

    // If no semantic chunks exist, fall back to keyword
    if (!hasSemanticChunks) {
      const keywordResults = keywordSearch(keywordChunks, effectiveQuery, effectiveTopK)
      return {
        context: buildRagContextBlock(effectiveQuery, keywordResults, 'keyword', isFullAccess),
        sources: keywordResults,
        searched: true,
        mode: 'keyword',
      }
    }

    // Run keyword search (always available as fallback)
    const keywordResults = keywordSearch(keywordChunks, effectiveQuery, effectiveKeywordTopK)

    // Run semantic search
    let semanticResults: RagSearchResult[] = []
    try {
      const { getEmbedding, parseEmbedding, cosineSimilarity } = await import('@/lib/rag')
      const { isSameOllamaModel } = await import('@/lib/embedding-models')
      const { getUserSettings } = await import('@/lib/settings')

      const settings = await getUserSettings(userId)
      const queryEmbedding = await getEmbedding(effectiveQuery, settings.ragModel, settings.ollamaHost, settings.ollamaApiKey, 20000)

      semanticResults = keywordChunks
        .filter(chunk =>
          chunk.embedding &&
          chunk.ragMode === 'semantic' &&
          (!chunk.embeddingModel || isSameOllamaModel(chunk.embeddingModel, settings.ragModel))
        )
        .map(chunk => {
          const embedding = parseEmbedding(chunk.embedding)
          const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0
          return {
            chunkId: chunk.chunkId,
            chunkIndex: chunk.chunkIndex,
            documentChunkCount: chunk.documentChunkCount,
            documentId: chunk.documentId,
            filename: chunk.filename,
            sourcePath: chunk.sourcePath,
            content: chunk.content,
            score,
            mode: 'semantic' as const,
            embeddingModel: chunk.embeddingModel,
            extension: chunk.extension,
            fileKind: chunk.fileKind,
            documentSize: chunk.documentSize,
            excerptChars: chunk.excerptChars,
            wholeDocument: chunk.wholeDocument,
          }
        })
        .filter(r => isFullAccess ? r.score > 0 : r.score > 0.2)
        .sort((a, b) => b.score - a.score)
        .slice(0, effectiveSemanticTopK)
    } catch (semanticError) {
      console.warn('KB semantic search failed, using keyword only:', semanticError)
      return {
        context: buildRagContextBlock(effectiveQuery, keywordResults, 'keyword', isFullAccess),
        sources: keywordResults,
        searched: true,
        mode: 'keyword',
        error: String(semanticError),
      }
    }

    // Reciprocal Rank Fusion
    const ranked = fuseRRF(semanticResults, keywordResults, isFullAccess ? 10000 : effectiveTopK)

    return {
      context: buildRagContextBlock(effectiveQuery, ranked, 'hybrid', isFullAccess),
      sources: ranked,
      searched: true,
      mode: ranked.some(r => r.mode === 'semantic') ? 'hybrid' : 'keyword',
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

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

function fuseRRF(
  semanticResults: RagSearchResult[],
  keywordResults: RagSearchResult[],
  topK: number,
  k = 60,
): RagSearchResult[] {
  const seen = new Map<string, RagSearchResult>()
  const rankMap = new Map<string, { score: number; mode: RagMode }>()

  const addResults = (results: RagSearchResult[], weight: number) => {
    results.forEach((result, index) => {
      const rrf = weight / (k + index + 1)
      const existing = rankMap.get(result.chunkId)
      if (existing) {
        existing.score += rrf
      } else {
        rankMap.set(result.chunkId, { score: rrf, mode: result.mode })
        seen.set(result.chunkId, result)
      }
    })
  }

  // Semantic gets slightly more weight (semantic captures semantic similarity)
  addResults(semanticResults, 1.0)
  addResults(keywordResults, 0.7)

  return Array.from(rankMap.entries())
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, topK)
    .map(([chunkId]) => {
      const result = seen.get(chunkId)!
      const meta = rankMap.get(chunkId)!
      return { ...result, mode: meta.mode }
    })
}

// ─── Context Block Builder ────────────────────────────────────────────────────

function buildSourceHeader(source: RagSearchResult, index: number, excerptChars: number): string {
  const metadata = [
    source.fileKind || 'document',
    source.extension ? `.${source.extension}` : null,
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
    const content = source.wholeDocument && source.content.length > MAX_SOURCE_EXCERPT_CHARS
      ? source.content
      : source.content.length > MAX_SOURCE_EXCERPT_CHARS
      ? source.content.slice(0, MAX_SOURCE_EXCERPT_CHARS) + '…'
      : source.content
    const excerptChars = source.wholeDocument
      ? source.content.length
      : Math.min(source.content.length, MAX_SOURCE_EXCERPT_CHARS)
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
  return full.length > limit ? full.slice(0, limit) + '…' : full
}

// ─── Chat Augmentation Helper ─────────────────────────────────────────────────

export interface AugmentMessagesOptions {
  messages: InternalChatMessage[]
  knowledgeQuery?: string
  signal?: AbortSignal
  ragEnabled?: boolean
  topK?: number
  filters?: RagSearchFilters
}

export interface InternalChatMessage {
  role: 'user' | 'assistant' | 'system'
  content?: string
  images?: string[]
}

export async function augmentMessagesWithKnowledgeBase(
  options: AugmentMessagesOptions,
  userId: string,
): Promise<{ messages: InternalChatMessage[]; knowledgeSources: RagSearchResult[] }> {
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

  const systemMessage: InternalChatMessage = {
    role: 'system',
    content: result.context,
  }

  return {
    messages: [systemMessage, ...options.messages],
    knowledgeSources: result.sources,
  }
}

function findLatestUserQuery(messages: InternalChatMessage[]): string {
  // Walk backwards through messages to find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user' && msg.content?.trim()) {
      return msg.content.trim()
    }
  }
  return ''
}
