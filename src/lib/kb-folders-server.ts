// Server-only counterpart to `./kb-folders`. Kept in its own file so the
// pure helpers (which client components import as types and small utilities)
// don't pull Prisma + pg into the browser bundle.

import {
  buildKnowledgeBaseTreeSummary,
  type KbFolderDocSummary,
} from './kb-folders'
import { detectFileKind } from './file-shared'

export interface LoadTreeSummaryOptions {
  signal?: AbortSignal
  maxChars?: number
  maxDepth?: number
}

export async function loadTreeSummary(
  userId: string,
  options: LoadTreeSummaryOptions = {},
): Promise<string> {
  if (!userId) return ''
  const { prisma } = await import('./prisma')
  const rows = await prisma.document.findMany({
    where: { userId },
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
  })

  if (rows.length === 0) return ''

  // Backfill `kind` if missing (older rows may have null kind).
  const docs: KbFolderDocSummary[] = rows.map(row => ({
    id: row.id,
    filename: row.filename,
    sourcePath: row.sourcePath ?? null,
    kind: row.kind ?? detectFileKind(row.filename, ''),
    size: typeof row.size === 'number' ? row.size : Number(row.size) || 0,
    status: row.status,
    ragMode: row.ragMode ?? null,
    createdAt: row.createdAt,
    indexedAt: row.indexedAt ?? null,
  }))

  return buildKnowledgeBaseTreeSummary(docs, {
    maxChars: options.maxChars,
    maxDepth: options.maxDepth,
  })
}
