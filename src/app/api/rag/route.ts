import { after, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { Document as PrismaDocument } from '@prisma/client';
import { getCurrentUserIdWithPermission } from '@/lib/request-auth';
import { type AppSettings, getUserSettings } from '@/lib/settings';
import { getErrorMessage } from '@/lib/rag';
import { extractFilePayload } from '@/lib/file-extraction';
import { detectFileKind } from '@/lib/file-shared';
import { type ExtractedFilePayload, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/file-shared';
import { markStaleProcessingDocuments } from '@/lib/rag-health';
import { enqueueDocumentIndexing } from '@/lib/rag-queue';
import {
  aggregateFolderTree,
  findFolderInTree,
  normalizeFolderPath,
} from '@/lib/kb-folders';

type Document = PrismaDocument;

const MAX_RAG_TEXT_CHARS = 2_000_000;

export const maxDuration = 900;

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

interface FolderRow {
  name: string;
  path: string;
  directFileCount: number;
  recursiveFileCount: number;
  directSize: number;
  recursiveSize: number;
  depth: number;
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

    const extraction = await extractFilePayload({
      name: filename,
      type: fileType,
      size,
      buffer,
      maxTextChars: MAX_RAG_TEXT_CHARS,
    });

    const text = extraction.text;
    if (!text || text.trim().length === 0) {
      throw new Error(getNoTextError(filename, extraction));
    }

    await enqueueDocumentIndexing(documentId, text, filename, fileType, {
      ragModel: settings.ragModel,
      ragMode: settings.ragMode as 'semantic' | 'keyword',
      ollamaHost: settings.ollamaHost,
      ollamaApiKey: settings.ollamaApiKey ?? '',
    });
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
  return processDocumentUpload(input);
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
    const rawFolder = url.searchParams.get('folder');
    const folder = normalizeFolderPathParam(rawFolder);
    const viewParam = (url.searchParams.get('view') ?? 'files').toLowerCase();
    const view: 'all' | 'files' | 'folders' = viewParam === 'all' || viewParam === 'folders' ? viewParam : 'files';
    const sortParam = (url.searchParams.get('sort') ?? 'createdAt').toLowerCase();
    const orderParam = (url.searchParams.get('order') ?? 'desc').toLowerCase();
    const order: 'asc' | 'desc' = orderParam === 'asc' ? 'asc' : 'desc';
    const kindFilter = (url.searchParams.get('kind') ?? '').trim();

    // Build the shared WHERE for "all docs in this folder prefix" (used for
    // the files fetch + the folder aggregation). When the user wants folders
    // only and the folder path is non-empty, we still need to fetch the same
    // set so we can derive the child folders server-side.
    const folderWhere: Prisma.DocumentWhereInput = folder === ''
      ? { userId }
      : {
          userId,
          OR: [
            { sourcePath: folder },
            { sourcePath: { startsWith: `${folder}/` } },
          ],
        };

    const kindWhere: Prisma.DocumentWhereInput = kindFilter ? { kind: kindFilter } : {};
    const where: Prisma.DocumentWhereInput = {
      AND: [folderWhere, kindWhere],
    };

    // When the caller doesn't ask for the new fields at all, fall through to
    // the legacy response shape exactly. This preserves backward compat for
    // every existing client.
    const hasNewParams = rawFolder !== null
      || url.searchParams.has('view')
      || url.searchParams.has('sort')
      || url.searchParams.has('order')
      || url.searchParams.has('kind');

    if (!hasNewParams) {
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
    }

    // New path: paginated files + optional folder aggregation.
    // When view === 'folders', the file fetch is skipped and folder rows are
    // computed in-memory from the matching document set.
    let documents: Awaited<ReturnType<typeof fetchFilePage>> = [];
    let pagination: DocumentsPagination | null = null;
    let total = 0;
    let totalPages = 0;
    let page = 1;
    let skip = 0;

    if (view !== 'folders') {
      total = await prisma.document.count({ where });
      totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
      page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
      skip = (page - 1) * pageSize;

      const orderBy = buildOrderBy(sortParam, order);
      documents = await fetchFilePage({ where, orderBy, skip, take: pageSize });
      pagination = {
        page,
        pageSize,
        total,
        totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
        hasNextPage: page < totalPages,
      };
    }

    // Folder aggregation: when view is 'all' or 'folders', compute immediate
    // children folders at the current path.
    let folders: FolderRow[] | undefined;
    if (view !== 'files') {
      const aggRows = await prisma.document.findMany({
        where: folderWhere,
        select: {
          id: true,
          filename: true,
          sourcePath: true,
          kind: true,
          size: true,
          status: true,
          ragMode: true,
          createdAt: true,
          indexedAt: true,
        },
      });
      const summaryDocs = aggRows.map((row) => ({
        id: row.id,
        filename: row.filename,
        sourcePath: row.sourcePath ?? null,
        kind: row.kind ?? detectFileKind(row.filename, ''),
        size: typeof row.size === 'number' ? row.size : Number(row.size) || 0,
        status: row.status,
        ragMode: row.ragMode ?? null,
        createdAt: row.createdAt,
        indexedAt: row.indexedAt ?? null,
      }));
      const root = aggregateFolderTree(summaryDocs);
      const node = findFolderInTree(root, folder);
      if (node) {
        const childFolders = view === 'folders'
          ? node.children
          : node.children;
        folders = childFolders
          .map((child) => ({
            name: child.name,
            path: child.path,
            directFileCount: child.directFileCount,
            recursiveFileCount: child.recursiveFileCount,
            directSize: child.directSize,
            recursiveSize: child.recursiveSize,
            depth: child.depth,
          }));
      } else {
        folders = [];
      }
    }

    return NextResponse.json({
      documents: view === 'folders' ? [] : documents,
      folders,
      pagination: pagination ?? {
        page: 1,
        pageSize,
        total: 0,
        totalPages: 0,
        hasPreviousPage: false,
        hasNextPage: false,
      },
      view,
      currentFolder: folder,
      sort: sortParam,
      order,
    });
  } catch (error) {
    console.error('RAG list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function normalizeFolderPathParam(value: string | null): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/')
    .trim();
}

function buildOrderBy(sort: string, order: 'asc' | 'desc'): Prisma.DocumentOrderByWithRelationInput | undefined {
  switch (sort) {
    case 'name':
      return { filename: order };
    case 'size':
      return { size: order };
    case 'createdAt':
      return { createdAt: order };
    case 'indexedAt':
      return { indexedAt: order };
    case 'kind':
      // Prisma orderBy on `kind` is alphabetical; use the order param directly.
      return { kind: order };
    default:
      return { createdAt: order };
  }
}

type FilePageDoc = Prisma.DocumentGetPayload<{ include: { _count: { select: { chunks: true } } } }>

async function fetchFilePage({
  where,
  orderBy,
  skip,
  take,
}: {
  where: Prisma.DocumentWhereInput
  orderBy: Prisma.DocumentOrderByWithRelationInput | undefined
  skip: number
  take: number
}): Promise<FilePageDoc[]> {
  return prisma.document.findMany({
    where,
    orderBy,
    include: { _count: { select: { chunks: true } } },
    skip,
    take,
  })
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
    const lowerName = file.name.toLowerCase();
    const lowerMime = (file.type || '').toLowerCase();
    const shouldRetainOriginal = lowerMime.includes('pdf')
      || lowerName.endsWith('.pdf')
      || lowerMime.includes('spreadsheet')
      || lowerMime.includes('excel')
      || lowerName.endsWith('.xlsx')
      || lowerName.endsWith('.xlsm')
      || lowerName.endsWith('.xls')
      || lowerMime.includes('wordprocessingml')
      || lowerMime.includes('msword')
      || lowerName.endsWith('.docx')
      || lowerName.endsWith('.doc');
    const originalContent = shouldRetainOriginal ? buffer.toString('base64') : null;
    const originalMimeType = shouldRetainOriginal
      ? (file.type || (lowerName.endsWith('.pdf')
        ? 'application/pdf'
        : lowerName.endsWith('.docx') || lowerName.endsWith('.doc')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      : null;

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
            originalContent,
            originalMimeType,
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
            originalContent,
            originalMimeType,
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

    const payload = await req.json().catch(() => ({})) as {
      id?: string;
      ids?: string[];
      folder?: string;
    };
    const ids = Array.isArray(payload.ids)
      ? payload.ids
      : typeof payload.id === 'string'
        ? [payload.id]
        : [];

    const normalizedIds = ids
      .map(id => typeof id === 'string' ? id.trim() : '')
      .filter((id): id is string => Boolean(id));

    const folder = typeof payload.folder === 'string' ? normalizeFolderPath(payload.folder) : '';

    if (normalizedIds.length === 0 && folder === '') {
      return NextResponse.json({ error: 'Document ID or folder path required' }, { status: 400 });
    }

    // If a folder is specified (with or without explicit ids), we cascade by
    // selecting every doc whose sourcePath is exactly the folder or starts
    // with "<folder>/". The ids list can further narrow the delete.
    let where: Prisma.DocumentWhereInput;
    let resolvedFolder: string | undefined;
    if (folder !== '') {
      where = {
        userId,
        OR: [
          { sourcePath: folder },
          { sourcePath: { startsWith: `${folder}/` } },
        ],
        ...(normalizedIds.length > 0 ? { id: { in: normalizedIds } } : {}),
      };
      resolvedFolder = folder;
    } else {
      where = { userId, id: { in: normalizedIds } };
    }

    // Collect the ids that match before deleting so the client can prune
    // its in-memory selection list (the bulk-delete UI tracks ids that may
    // span folders and pages, so it needs the ground truth from the server).
    const matchingRows = await prisma.document.findMany({
      where,
      select: { id: true },
    });
    const matchingIds = matchingRows.map(row => row.id);

    const deleteResult = await prisma.document.deleteMany({ where });

    if (normalizedIds.length === 1 && !folder && deleteResult.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      deleted: deleteResult.count,
      folder: resolvedFolder,
      ids: matchingIds,
    });
  } catch (error) {
    console.error('RAG delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}