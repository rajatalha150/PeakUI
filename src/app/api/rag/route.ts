import { after, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getCurrentUserIdWithPermission } from '@/lib/request-auth';
import { type AppSettings, getUserSettings } from '@/lib/settings';
import { chunkText, getEmbeddings, getErrorMessage } from '@/lib/rag';
import { extractFilePayload } from '@/lib/file-extraction';
import { detectFileKind } from '@/lib/file-shared';
import { type ExtractedFilePayload, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/file-shared';
import { markStaleProcessingDocuments } from '@/lib/rag-health';

const MAX_RAG_TEXT_CHARS = 2_000_000;

const EMBEDDING_BATCH_SIZE = 16;
const EMBEDDING_UPLOAD_TIMEOUT_MS = 45000;
const CHUNK_INSERT_BATCH_SIZE = 100;

export const maxDuration = 900;

let ragIndexQueue: Promise<void> = Promise.resolve();
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface DocumentsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

interface ProcessDocumentUploadInput {
  documentId: string;
  filename: string;
  fileType: string;
  size: number;
  contentHash: string;
  sourcePath: string | null;
  buffer: Buffer;
  settings: AppSettings;
}

async function embedChunks(
  chunks: string[],
  model: string,
  ollamaHost: string,
  onBatchComplete?: () => Promise<void>
): Promise<number[][]> {
  const embeddings: number[][] = [];
  const MAX_RETRIES = 2;
  const RETRY_DELAYS_MS = [5000, 15000];

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const batchEmbeddings = await getEmbeddings(batch, model, ollamaHost, EMBEDDING_UPLOAD_TIMEOUT_MS);
        embeddings.push(...batchEmbeddings);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          console.warn(`RAG embedding batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1} failed (attempt ${attempt + 1}), retrying in ${RETRY_DELAYS_MS[attempt]}ms:`, error instanceof Error ? error.message : String(error));
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
      }
    }

    if (lastError) throw lastError;
    await onBatchComplete?.();
  }

  return embeddings;
}

function getRequestContentLength(req: Request): number | null {
  const header = req.headers.get('content-length');
  if (!header) return null;

  const value = Number(header);
  return Number.isFinite(value) ? value : null;
}

function getNoTextError(filename: string, extraction: ExtractedFilePayload): string {
  if (extraction.extractionStatus === 'unsupported') {
    return `No text extractor is available for "${filename}" (${extraction.type}). Knowledge Base indexing requires extractable text.`;
  }

  return extraction.statusMessage || 'File appears to be empty or unreadable.';
}

async function markDocumentError(documentId: string, message: string) {
  await prisma.documentChunk.deleteMany({ where: { documentId } }).catch(error => {
    console.error('Failed to clear errored document chunks:', error);
  });

  await prisma.document.updateMany({
    where: { id: documentId },
    data: {
      status: 'error',
      errorMessage: message,
      indexedAt: null,
    },
  });
}

async function touchProcessingDocument(documentId: string) {
  await prisma.document.updateMany({
    where: {
      id: documentId,
      status: 'processing',
    },
    data: {
      indexedAt: new Date(),
    },
  });
}

async function insertChunks(documentId: string, chunks: string[], embeddings: number[][], semantic: boolean) {
  await prisma.documentChunk.deleteMany({ where: { documentId } });

  for (let i = 0; i < chunks.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const chunkBatch = chunks.slice(i, i + CHUNK_INSERT_BATCH_SIZE);

    await prisma.documentChunk.createMany({
      data: chunkBatch.map((chunk, offset) => {
        const embedding = semantic ? embeddings[i + offset] : null;

        return {
          chunkIndex: i + offset,
          content: chunk,
          embedding: embedding ? JSON.stringify(embedding) : null,
          documentId,
        };
      }),
    });
  }
}

async function processDocumentUpload({
  documentId,
  filename,
  fileType,
  size,
  contentHash,
  sourcePath,
  buffer,
  settings,
}: ProcessDocumentUploadInput) {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true, contentHash: true },
    });

    if (!doc || !['queued', 'processing'].includes(doc.status)) return;
    if (doc.contentHash !== contentHash) {
      console.info(`Skipping stale RAG task for ${filename} (${documentId}) because a newer upload superseded it.`);
      return;
    }

    await prisma.document.updateMany({
      where: { id: documentId },
      data: {
        status: 'processing',
        errorMessage: null,
        indexedAt: new Date(),
      },
    });

    console.info(`RAG indexing started for ${sourcePath ? `${sourcePath} → ${filename}` : filename} (${documentId})`);

    await touchProcessingDocument(documentId);

    const extraction = await extractFilePayload({
      name: filename,
      type: fileType,
      size,
      buffer,
      maxTextChars: MAX_RAG_TEXT_CHARS,
    });
    await touchProcessingDocument(documentId);

    const text = extraction.text;
    if (!text || text.trim().length === 0) {
      throw new Error(getNoTextError(filename, extraction));
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error('File did not contain enough text to index.');
    }

    let indexedMode = settings.ragMode;
    let fallbackMessage: string | null = null;
    let embeddings: number[][] = [];

    if (settings.ragMode === 'semantic') {
      try {
        embeddings = await embedChunks(chunks, settings.ragModel, settings.ollamaHost, () => touchProcessingDocument(documentId));
      } catch (error) {
        const rawMessage = getErrorMessage(error);
        indexedMode = 'keyword';
        fallbackMessage = `Semantic embedding failed, so this file was indexed with Keyword/BM25 fallback. Details: ${rawMessage}`;
        console.warn(`RAG semantic indexing fallback for ${filename} (${documentId}):`, error);
      }
    }

    await insertChunks(documentId, chunks, embeddings, indexedMode === 'semantic');

    const update = await prisma.document.updateMany({
      where: { id: documentId },
      data: {
        status: 'ready',
        ragMode: indexedMode,
        embeddingModel: indexedMode === 'semantic' ? settings.ragModel : null,
        ollamaHost: indexedMode === 'semantic' ? settings.ollamaHost : null,
        indexedAt: new Date(),
        errorMessage: fallbackMessage,
      },
    });

    if (update.count > 0) {
      console.info(`RAG indexing completed for ${filename} (${documentId}) with ${chunks.length} chunks`);
    }
  } catch (error) {
    const rawMessage = getErrorMessage(error);
    const message = settings.ragMode === 'semantic' && rawMessage.toLowerCase().includes('embedding')
      ? `Embedding model "${settings.ragModel}" failed at ${settings.ollamaHost}. Go to Settings and click Test, or run: ollama pull ${settings.ragModel}\n\nDetails: ${rawMessage}`
      : rawMessage;

    console.error(`RAG background indexing failed for ${filename} (${documentId}):`, error);

    await markDocumentError(documentId, message).catch(updateError => {
      console.error('Failed to mark document errored:', updateError);
    });
  }
}

function queueDocumentUpload(input: ProcessDocumentUploadInput) {
  const task = ragIndexQueue
    .catch(() => undefined)
    .then(() => processDocumentUpload(input));

  ragIndexQueue = task.catch(() => undefined);
  return task;
}

function parsePageParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function parsePageSizeParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(parsed)));
}

// GET: List documents for user
export async function GET(req: Request) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const requestedPage = parsePageParam(url.searchParams.get('page'), 1);
    const pageSize = parsePageSizeParam(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);
    const total = await prisma.document.count({ where: { userId } });
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const skip = (page - 1) * pageSize;

    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
      skip,
      take: pageSize,
    });

    const pagination: DocumentsPagination = {
      page,
      pageSize,
      total,
      totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
      hasNextPage: page < totalPages,
    };

    return NextResponse.json({ documents, pagination });
  } catch (error) {
    console.error('RAG list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Upload and process a document
export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await markStaleProcessingDocuments(userId);

    const contentLength = getRequestContentLength(req);
    if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({
        error: `Upload is too large. Knowledge base files are limited to ${MAX_UPLOAD_LABEL}.`
      }, { status: 413 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (error) {
      console.error('RAG upload form parse error:', error);
      return NextResponse.json({
        error: `Could not read the uploaded file. If it is larger than ${MAX_UPLOAD_LABEL}, split it into smaller files and try again.`
      }, { status: 400 });
    }

    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({
        error: `Upload is too large. Knowledge base files are limited to ${MAX_UPLOAD_LABEL}.`
      }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const settings = await getUserSettings(userId);
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const sourcePathField = formData.get('sourcePath');
    const sourcePath = typeof sourcePathField === 'string' && sourcePathField.trim()
      ? sourcePathField.trim()
      : null;
    const documentKind = detectFileKind(file.name, file.type || 'application/octet-stream');

    const existingDoc = await prisma.document.findFirst({
      where: {
        userId,
        filename: file.name,
        ...(sourcePath !== null ? { sourcePath } : { sourcePath: null }),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingDoc && existingDoc.contentHash === contentHash && ['ready', 'queued', 'processing'].includes(existingDoc.status)) {
      return NextResponse.json({
        success: true,
        queued: existingDoc.status !== 'ready',
        reused: true,
        document: { ...existingDoc, chunkCount: 0 },
      }, { status: existingDoc.status === 'ready' ? 200 : 202 });
    }

    // Allow re-upload of errored documents with matching content to retry indexing
    if (existingDoc && existingDoc.contentHash === contentHash && existingDoc.status === 'error') {
      await prisma.document.update({
        where: { id: existingDoc.id },
        data: { status: 'queued', errorMessage: null, indexedAt: null },
      });
    }

    const doc = existingDoc
      ? await prisma.document.update({
          where: { id: existingDoc.id },
          data: {
            filename: file.name,
            sourcePath,
            kind: documentKind,
            size: file.size,
            contentHash,
            status: 'queued',
            ragMode: settings.ragMode,
            embeddingModel: settings.ragMode === 'semantic' ? settings.ragModel : null,
            ollamaHost: settings.ragMode === 'semantic' ? settings.ollamaHost : null,
            errorMessage: null,
            indexedAt: null,
          },
        })
      : await prisma.document.create({
          data: {
            filename: file.name,
            sourcePath,
            kind: documentKind,
            size: file.size,
            contentHash,
            userId,
            status: 'queued',
            ragMode: settings.ragMode,
            embeddingModel: settings.ragMode === 'semantic' ? settings.ragModel : null,
            ollamaHost: settings.ragMode === 'semantic' ? settings.ollamaHost : null,
          }
        });

    after(async () => {
      await queueDocumentUpload({
        documentId: doc.id,
        filename: file.name,
        fileType: file.type || 'application/octet-stream',
        size: file.size,
        contentHash,
        sourcePath,
        buffer,
        settings,
      });
    });

    return NextResponse.json({
      success: true,
      queued: true,
      document: { ...doc, chunkCount: 0 }
    }, { status: 202 });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('RAG upload error:', error);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove a document
export async function DELETE(req: Request) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({})) as { id?: string; ids?: string[] };
    const ids = Array.isArray(payload.ids)
      ? payload.ids
      : typeof payload.id === 'string'
        ? [payload.id]
        : [];

    const normalizedIds = ids
      .map(id => typeof id === 'string' ? id.trim() : '')
      .filter((id): id is string => Boolean(id));

    if (normalizedIds.length === 0) return NextResponse.json({ error: 'Document ID required' }, { status: 400 });

    const deleteResult = await prisma.document.deleteMany({
      where: { userId, id: { in: normalizedIds } },
    });

    if (normalizedIds.length === 1 && deleteResult.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: deleteResult.count });
  } catch (error) {
    console.error('RAG delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
