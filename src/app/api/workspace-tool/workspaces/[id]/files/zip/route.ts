import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import type { Archiver, ArchiverOptions } from 'archiver'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getWorkspaceToolWorkspaceById } from '@/lib/workspace-tool-project-workspaces'

// archiver is a CommonJS module; @types/archiver exposes the Archiver class
// but not the top-level factory. Mirror the pattern from
// src/lib/archive/archive-renderer.ts.
type ArchiverFactory = (format: 'zip', options?: ArchiverOptions) => Archiver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiverModule = require('archiver') as ArchiverFactory | { default: ArchiverFactory }
const archiver: ArchiverFactory = (archiverModule as { default?: ArchiverFactory }).default ?? (archiverModule as ArchiverFactory)

export const runtime = 'nodejs'

const REQUIRED_PERMISSIONS = ['workspace-tool.use', 'workspace-tool.filesystem'] as const
const MAX_ZIP_BYTES = 500 * 1024 * 1024 // 500 MB cap for an entire bulk-download zip
const MAX_FILES_PER_ZIP = 500

interface RouteContext {
  params: Promise<{ id: string }>
}

function normalizeRelativePath(input: string | null | undefined): string {
  if (!input) return ''
  return input.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isPathSafe(relativePath: string): boolean {
  if (relativePath.includes('\0')) return false
  for (const segment of relativePath.split('/')) {
    if (segment === '..' || segment === '.' || segment.length === 0) return false
  }
  return true
}

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await context.params
  const workspace = await getWorkspaceToolWorkspaceById(access.userId, workspaceId)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found', code: 'not_found' }, { status: 404 })
  }
  await fs.mkdir(workspace.containerPath, { recursive: true })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON', code: 'invalid_request' }, { status: 400 })
  }
  const { paths } = (body ?? {}) as { paths?: unknown }
  if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string')) {
    return NextResponse.json({ error: 'paths must be an array of strings', code: 'invalid_request' }, { status: 400 })
  }
  if (paths.length === 0) {
    return NextResponse.json({ error: 'paths must not be empty', code: 'invalid_request' }, { status: 400 })
  }
  if (paths.length > MAX_FILES_PER_ZIP) {
    return NextResponse.json(
      { error: `Too many files in a single zip (max ${MAX_FILES_PER_ZIP})`, code: 'payload_too_large' },
      { status: 413 }
    )
  }

  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(async () => {
    await fs.mkdir(workspace.containerPath, { recursive: true })
    return fs.realpath(workspace.containerPath)
  })

  const safePaths: string[] = []
  for (const raw of paths) {
    const relative = normalizeRelativePath(raw as string)
    if (!relative || !isPathSafe(relative)) {
      return NextResponse.json({ error: `Invalid path: ${raw}`, code: 'invalid_path' }, { status: 400 })
    }
    const absolute = path.join(workspace.containerPath, relative)
    const real = await fs.realpath(absolute).catch(() => null)
    if (!real || (!real.startsWith(realWorkspaceRoot + path.sep) && real !== realWorkspaceRoot)) {
      return NextResponse.json(
        {
          error: `Path is outside the workspace: ${relative}`,
          code: 'outside_workspace',
          actionRequired: `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), target: ${real}`,
        },
        { status: 403 }
      )
    }
    safePaths.push(relative)
  }

  // Build the zip stream. We resolve files/dirs at archive time so the
  // top-level zip entries preserve the workspace-relative folder structure.
  const archive = archiver('zip', { zlib: { level: 9 } })

  // Asynchronously add files. For each path: if it's a file, add it once;
  // if it's a directory, recursively add its tree.
  let totalBytes = 0
  for (const rel of safePaths) {
    const absolute = path.join(workspace.containerPath, rel)
    let stat: import('fs').Stats
    try {
      stat = await fs.stat(absolute)
    } catch {
      continue
    }
    if (stat.isFile()) {
      totalBytes += stat.size
      if (totalBytes > MAX_ZIP_BYTES) {
        archive.destroy()
        return NextResponse.json(
          { error: `Bulk download exceeds ${MAX_ZIP_BYTES / 1024 / 1024} MB total`, code: 'payload_too_large' },
          { status: 413 }
        )
      }
      archive.file(absolute, { name: rel })
    } else if (stat.isDirectory()) {
      // Use archive.directory to recursively include the folder.
      const entries = await collectDirectoryEntries(absolute, realWorkspaceRoot)
      for (const entry of entries) {
        totalBytes += entry.size
        if (totalBytes > MAX_ZIP_BYTES) {
          archive.destroy()
          return NextResponse.json(
            { error: `Bulk download exceeds ${MAX_ZIP_BYTES / 1024 / 1024} MB total`, code: 'payload_too_large' },
            { status: 413 }
          )
        }
        archive.file(entry.absolute, { name: entry.nameInZip })
      }
    }
  }

  // Tell the archive we're done. It will finalize the central directory
  // and emit 'end' / close the underlying stream.
  archive.finalize()

  const headers: Record<string, string> = {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="workspace-files.zip"`,
    'Cache-Control': 'no-store',
  }

  // archiver IS a Node Readable stream; NextResponse accepts a Web
  // ReadableStream, which Node 18+ exposes via the ReadableSymbol. The
  // cast matches the one used in the download route.
  return new NextResponse(archive as unknown as ReadableStream, { headers })
}

interface CollectedEntry {
  absolute: string
  nameInZip: string
  size: number
}

async function collectDirectoryEntries(absoluteDir: string, workspaceRoot: string): Promise<CollectedEntry[]> {
  const out: CollectedEntry[] = []
  async function walk(currentAbs: string, currentRelInZip: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(currentAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const childAbs = path.join(currentAbs, entry.name)
      // Defense in depth: every entry must resolve inside the workspace root.
      const real = await fs.realpath(childAbs).catch(() => null)
      if (!real || (!real.startsWith(workspaceRoot + path.sep) && real !== workspaceRoot)) continue
      const childRel = currentRelInZip ? `${currentRelInZip}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(real, childRel)
      } else {
        const stat = await fs.stat(real).catch(() => null)
        if (!stat) continue
        out.push({ absolute: real, nameInZip: childRel, size: stat.size })
      }
    }
  }
  await walk(absoluteDir, '')
  return out
}