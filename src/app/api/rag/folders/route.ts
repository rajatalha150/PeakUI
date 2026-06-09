import { NextResponse } from 'next/server'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import { prisma } from '@/lib/prisma'
import { aggregateFolderTree, findFolderInTree, getParentFolder, normalizeFolderPath, type KbFolderDocSummary } from '@/lib/kb-folders'
import { detectFileKind } from '@/lib/file-shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FoldersCacheEntry {
  tree: ReturnType<typeof aggregateFolderTree>
  fetchedAt: number
}

const CACHE_TTL_MS = 30_000
const foldersCache = new Map<string, FoldersCacheEntry>()

function findNode(root: ReturnType<typeof aggregateFolderTree>, folderPath: string) {
  if (folderPath === '') return root
  return findFolderInTree(root, folderPath)
}

export async function GET(req: Request) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const rawPrefix = url.searchParams.get('prefix') ?? ''
    const prefix = normalizeFolderPath(rawPrefix)
    const includeFiles = url.searchParams.get('includeFiles') === 'true'

    const cacheKey = `${userId}::${includeFiles ? 'files' : 'folders'}`
    const now = Date.now()
    const cached = foldersCache.get(cacheKey)
    let root = cached && (now - cached.fetchedAt) < CACHE_TTL_MS ? cached.tree : null

    if (!root) {
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
      root = aggregateFolderTree(docs)
      foldersCache.set(cacheKey, { tree: root, fetchedAt: now })
    }

    const node = prefix === '' ? root : findNode(root, prefix)
    if (!node) {
      return NextResponse.json({ error: `Folder not found: ${prefix}` }, { status: 404 })
    }

    // For convenience, also return the direct root files (no sourcePath) when
    // the caller asked for the root subtree and includeFiles is set.
    let directRootFiles: KbFolderDocSummary[] | undefined
    if (prefix === '' && includeFiles) {
      const rows = await prisma.document.findMany({
        where: { userId, OR: [{ sourcePath: null }, { sourcePath: '' }] },
        select: {
          id: true, filename: true, sourcePath: true, kind: true, size: true,
          status: true, ragMode: true, createdAt: true, indexedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      directRootFiles = rows.map(row => ({
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
    }

    return NextResponse.json({
      tree: node,
      currentPrefix: prefix,
      // Echo the parent so the client can render a ".." navigation affordance.
      parentPrefix: getParentFolder(prefix),
      directRootFiles,
    })
  } catch (error) {
    console.error('RAG folders tree error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
