import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/request-auth';
import { getUserSettings } from '@/lib/settings';
import { isSameOllamaModel } from '@/lib/embedding-models';
import { detectFileKind, getFileExtension, type FileKind } from '@/lib/file-shared';
import {
  cosineSimilarity,
  matchesRagFilters,
  getEmbedding,
  getErrorMessage,
  keywordSearch,
  parseEmbedding,
  parseRagQueryFilters,
  type RagSearchFilters,
  type RagSearchResult
} from '@/lib/rag';

interface SearchBody {
  query?: string;
  topK?: number;
  filters?: RagSearchFilters;
  filename?: string;
  folder?: string;
  extension?: string;
  fileKind?: RagSearchFilters['fileKind'];
  documentId?: string;
}

const SEARCH_EMBED_TIMEOUT_MS = 20000;

function normalizeTopK(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(12, Math.max(1, Math.round(parsed)));
}

function normalizeFilters(body: SearchBody): RagSearchFilters | undefined {
  const filters = body.filters || {};
  const normalized: RagSearchFilters = {
    filename: filters.filename?.trim() || body.filename?.trim() || undefined,
    folder: filters.folder?.trim() || body.folder?.trim() || undefined,
    extension: filters.extension?.trim().replace(/^\./, '').toLowerCase() || body.extension?.trim().replace(/^\./, '').toLowerCase() || undefined,
    fileKind: (filters.fileKind && filters.fileKind !== 'all' ? filters.fileKind : undefined) || (body.fileKind && body.fileKind !== 'all' ? body.fileKind : undefined),
    documentId: filters.documentId?.trim() || body.documentId?.trim() || undefined,
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function mergeFilters(primary?: RagSearchFilters, secondary?: RagSearchFilters): RagSearchFilters | undefined {
  const merged: RagSearchFilters = {
    filename: primary?.filename || secondary?.filename,
    folder: primary?.folder || secondary?.folder,
    extension: primary?.extension || secondary?.extension,
    fileKind: primary?.fileKind || secondary?.fileKind,
    documentId: primary?.documentId || secondary?.documentId,
  };

  return Object.values(merged).some(Boolean) ? merged : undefined;
}

// POST: Search the knowledge base for relevant chunks
export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as SearchBody;
    const { query, topK: requestedTopK } = body;
    const cleanQuery = query?.trim();
    if (!cleanQuery) return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    const parsedQuery = parseRagQueryFilters(cleanQuery);
    const fallbackQuery = [
      parsedQuery.filters?.filename,
      parsedQuery.filters?.folder,
      parsedQuery.filters?.extension,
      parsedQuery.filters?.fileKind,
    ].filter(Boolean).join(' ');
    const effectiveQuery = parsedQuery.query || fallbackQuery || cleanQuery;
    const filters = mergeFilters(normalizeFilters(body), parsedQuery.filters);

    const topK = normalizeTopK(requestedTopK);
    const settings = await getUserSettings(userId);

    const docCount = await prisma.document.count({
      where: { userId, status: 'ready' }
    });

    if (docCount === 0) {
      return NextResponse.json({ error: 'No documents in knowledge base yet. Upload some files first.' }, { status: 400 });
    }

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
          }
        }
      }
    });

    if (chunks.length === 0) return NextResponse.json([]);

    const keywordChunks = chunks.map(chunk => ({
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
      extension: getFileExtension(chunk.document.filename) || null,
      fileKind: (chunk.document.kind as FileKind | null | undefined) || detectFileKind(chunk.document.filename, ''),
      documentSize: chunk.document.size,
      excerptChars: chunk.content.length,
      wholeDocument: chunk.document._count.chunks === 1,
    })).filter(chunk => matchesRagFilters(chunk, filters));

    if (settings.ragMode === 'keyword') {
      return NextResponse.json(keywordSearch(keywordChunks, effectiveQuery, topK));
    }

    const semanticChunks = chunks.filter(chunk =>
      chunk.embedding &&
      (!chunk.document.embeddingModel || isSameOllamaModel(chunk.document.embeddingModel, settings.ragModel)) &&
      matchesRagFilters({
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
        extension: getFileExtension(chunk.document.filename) || null,
        fileKind: (chunk.document.kind as FileKind | null | undefined) || detectFileKind(chunk.document.filename, ''),
        documentSize: chunk.document.size,
        excerptChars: chunk.content.length,
        wholeDocument: chunk.document._count.chunks === 1,
      }, filters)
    );

    if (semanticChunks.length === 0) {
      return NextResponse.json(keywordSearch(keywordChunks, effectiveQuery, topK));
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await getEmbedding(effectiveQuery, settings.ragModel, settings.ollamaHost, SEARCH_EMBED_TIMEOUT_MS);
    } catch (error) {
      console.warn('RAG semantic search fallback to keyword:', error);
      return NextResponse.json(keywordSearch(keywordChunks, effectiveQuery, topK));
    }

    const scored: RagSearchResult[] = semanticChunks
      .map(chunk => {
        const embedding = parseEmbedding(chunk.embedding);
        const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;

        return {
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          documentChunkCount: chunk.document._count.chunks,
          documentId: chunk.document.id,
          filename: chunk.document.filename,
          sourcePath: chunk.document.sourcePath,
          content: chunk.content,
          score,
          mode: 'semantic',
          embeddingModel: chunk.document.embeddingModel,
          extension: getFileExtension(chunk.document.filename) || null,
          fileKind: (chunk.document.kind as FileKind | null | undefined) || detectFileKind(chunk.document.filename, ''),
          documentSize: chunk.document.size,
          excerptChars: chunk.content.length,
          wholeDocument: chunk.document._count.chunks === 1,
        } satisfies RagSearchResult;
      })
      .filter(result => result.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const keywordFallbackResults = keywordSearch(
      keywordChunks.filter(chunk => !chunk.embedding || chunk.ragMode === 'keyword'),
      effectiveQuery,
      topK
    );
    const seen = new Set<string>();
    const combined = [...scored, ...keywordFallbackResults]
      .filter(result => {
        if (seen.has(result.chunkId)) return false;
        seen.add(result.chunkId);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return NextResponse.json(combined);
  } catch (error) {
    console.error('RAG search error:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
