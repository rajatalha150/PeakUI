import { normalizeOllamaModelName } from './embedding-models'
import type { MessageSource } from './message-sources'
import type { RagMode } from './settings'
import { getFileExtension, type FileKind } from './file-shared'
import {
  augmentMessagesWithKnowledgeBase as engineAugmentMessages,
  buildKnowledgeBaseContext as engineBuildKnowledgeBaseContext,
  buildKnowledgeBaseRetrievalContract,
  buildRagContextBlock,
  chunkDocument,
  chunkTextByBoundaries,
  deduplicateResults,
  keywordSearch as engineKeywordSearch,
  normalizeSearchText,
  parseRagQueryFilters,
  tokenize,
  type ChunkMetadata,
  type KnowledgeBaseContextOptions,
  type KnowledgeBaseContextResult,
  type RagChunkWithMetadata,
  type RagSearchFilters,
  type RagSearchResult as EngineRagSearchResult,
} from './rag-engine'

export { buildKnowledgeBaseRetrievalContract, buildRagContextBlock, chunkDocument, chunkTextByBoundaries, deduplicateResults, normalizeSearchText, parseRagQueryFilters, tokenize }
export type { ChunkMetadata, KnowledgeBaseContextOptions, KnowledgeBaseContextResult, RagChunkWithMetadata, RagSearchFilters, EngineRagSearchResult }

// Backwards-compatible aliases.
export type { RagSearchFilters as RagSearchFilter }

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

export interface InternalChatMessage {
  role: 'user' | 'assistant' | 'system'
  content?: string
  images?: string[]
}

export const RagSearchResultExtended = null

export interface RagSearchResult extends MessageSource {
  chunkId: string
  chunkIndex?: number | null
  documentId: string
  rawScore?: number
  mode: 'semantic' | 'keyword' | 'hybrid' | 'unavailable'
}

interface EmbedResponse {
  embedding?: number[]
  embeddings?: number[][]
}

const DEFAULT_EMBED_TIMEOUT_MS = 120000
export const FULL_DOCUMENT_CONTEXT_CHAR_LIMIT = 4000

export function getErrorMessage(error: unknown, fallback = 'Internal server error'): string {
  return error instanceof Error ? error.message : fallback
}

/** Backwards-compatible fixed-size chunker (used by legacy callers). */
export function chunkText(text: string, chunkSize = 600, overlap = 80, fullDocumentLimit = FULL_DOCUMENT_CONTEXT_CHAR_LIMIT): string[] {
  return chunkTextByBoundaries(text, {
    targetChars: chunkSize,
    overlapChars: overlap,
    fullDocumentLimit,
  }).map(c => c.content)
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error.message.toLowerCase().includes('timeout')
  )
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

export async function getEmbeddings(
  input: string | string[],
  model: string,
  ollamaHost: string,
  apiKey: string,
  timeoutMs = DEFAULT_EMBED_TIMEOUT_MS,
): Promise<number[][]> {
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

/** Backwards-compatible cosine similarity helper. */
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

export function matchesRagFilters(chunk: RagChunkForSearch, filters?: RagSearchFilters): boolean {
  return true // deprecated; filtering is done in DB or by engine helpers
}

function mapToLegacySearchResult(result: RagSearchResult): RagSearchResult {
  return {
    chunkId: result.chunkId,
    chunkIndex: result.chunkIndex,
    documentId: result.documentId,
    filename: result.filename,
    sourcePath: result.sourcePath,
    content: result.content,
    score: result.score,
    rawScore: result.rawScore,
    mode: result.mode === 'hybrid' ? 'semantic' : result.mode as RagMode,
    embeddingModel: result.embeddingModel,
    extension: result.extension,
    fileKind: result.fileKind,
    documentSize: result.documentSize,
    excerptChars: result.excerptChars ?? result.content.length,
    wholeDocument: result.wholeDocument,
  }
}

/** Backwards-compatible keyword search interface. */
export function keywordSearch(chunks: RagChunkForSearch[], query: string, topK: number): RagSearchResult[] {
  const mapped: RagChunkWithMetadata[] = chunks.map(c => ({
    chunkId: c.chunkId,
    chunkIndex: c.chunkIndex ?? null,
    documentChunkCount: c.documentChunkCount ?? 1,
    documentId: c.documentId,
    filename: c.filename,
    sourcePath: c.sourcePath ?? null,
    content: c.content,
    metadata: null,
    embedding: c.embedding ?? null,
    embeddingModel: c.embeddingModel ?? null,
    ragMode: c.ragMode ?? 'keyword',
    extension: c.extension ?? getFileExtension(c.filename),
    fileKind: c.fileKind || 'document',
    documentSize: c.documentSize ?? 0,
    wholeDocument: c.wholeDocument ?? false,
  }))
  return engineKeywordSearch(mapped, query, topK).map(mapToLegacySearchResult)
}

export async function buildKnowledgeBaseContext(
  query: string,
  userId: string,
  options: KnowledgeBaseContextOptions = {},
): Promise<KnowledgeBaseContextResult> {
  const result = await engineBuildKnowledgeBaseContext(query, userId, options)
  return {
    ...result,
    sources: result.sources.map(mapToLegacySearchResult),
  }
}

export interface AugmentMessagesOptions {
  messages: InternalChatMessage[]
  knowledgeQuery?: string
  signal?: AbortSignal
  ragEnabled?: boolean
  topK?: number
  filters?: RagSearchFilters
}

export async function augmentMessagesWithKnowledgeBase(
  options: AugmentMessagesOptions,
  userId: string,
): Promise<{ messages: InternalChatMessage[]; knowledgeSources: RagSearchResult[] }> {
  const result = await engineAugmentMessages({
    messages: options.messages,
    knowledgeQuery: options.knowledgeQuery,
    signal: options.signal,
    ragEnabled: options.ragEnabled,
    topK: options.topK,
    filters: options.filters,
  }, userId)
  return {
    messages: result.messages,
    knowledgeSources: result.knowledgeSources.map(mapToLegacySearchResult),
  }
}
