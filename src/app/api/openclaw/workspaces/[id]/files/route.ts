import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getOpenClawWorkspaceById } from '@/lib/openclaw-project-workspaces'
import { publishWorkspaceEvent } from '@/lib/workspace-files-pubsub'
import type { WorkspaceTreeResponse } from '@/lib/workspace-files-types'

export const runtime = 'nodejs'

const REQUIRED_PERMISSIONS = ['openclaw.use', 'openclaw.filesystem'] as const

interface RouteContext {
  params: Promise<{ id: string }>
}

function badRequest(error: string, code: string, status = 400, actionRequired?: string) {
  return NextResponse.json({ error, code, ...(actionRequired ? { actionRequired } : {}) }, { status })
}

function buildEtag(stat: { size: number; mtimeMs: number }): string {
  return `"${stat.size}-${Math.floor(stat.mtimeMs)}"`
}

function normalizeRelativePath(input: string | null | undefined): string {
  if (!input) return ''
  // Forward slashes only. Strip leading slashes. Reject backslashes outright
  // (Linux-only container path; Windows host paths don't reach here).
  return input.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isPathSafe(relativePath: string): boolean {
  if (relativePath.includes('\0')) return false
  // Walk segments and reject any '..' or empty segment (which catches '..', '..//foo', 'foo//bar').
  for (const segment of relativePath.split('/')) {
    if (segment === '..' || segment === '.' || segment.length === 0) return false
  }
  return true
}

async function resolveWorkspace(authUserId: string, workspaceId: string) {
  const record = await getOpenClawWorkspaceById(authUserId, workspaceId)
  if (!record) return null
  // Ensure the workspace container path exists before any route resolves paths
  // against it. On a fresh bind mount or after host restart the directory may
  // be missing even though the metadata file exists on the persistent volume.
  await fs.mkdir(record.containerPath, { recursive: true })
  return record
}

function buildResponse(
  record: NonNullable<Awaited<ReturnType<typeof resolveWorkspace>>>,
  relativePath: string,
  entries: WorkspaceTreeResponse['entries'],
  truncated: boolean
): WorkspaceTreeResponse {
  return {
    workspace: {
      id: record.id,
      slug: record.slug,
      name: record.name,
      containerPath: record.containerPath,
      hostPath: record.hostPath,
    },
    path: relativePath,
    entries,
    truncated,
  }
}

async function readDirEntries(
  absolutePath: string,
  hostRoot: string,
  workspaceRelativePath: string,
  options: { depth: number; currentDepth: number; cap: number }
): Promise<{ entries: WorkspaceTreeResponse['entries']; truncated: boolean }> {
  const collected: WorkspaceTreeResponse['entries'] = []
  let truncated = false
  let remaining = options.cap

  async function walk(absDir: string, relDir: string, depthRemaining: number): Promise<void> {
    if (remaining <= 0) {
      truncated = true
      return
    }
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ENOENT') return
      throw error
    }
    // Sort: directories first, then alpha (case-insensitive).
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    })

    for (const entry of entries) {
      if (remaining <= 0) {
        truncated = true
        break
      }
      const childAbs = path.join(absDir, entry.name)
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name

      // Skip workspace metadata, git internals, and node_modules from listing by default.
      if (childRel === '.openclaw-workspace.json') continue
      if (entry.name === '.git') continue
      if (entry.name === 'node_modules') continue

      let size: number | undefined
      let modifiedAt: string | undefined
      let childIsDir = entry.isDirectory()

      try {
        const stat = await fs.stat(childAbs)
        size = stat.size
        modifiedAt = stat.mtime.toISOString()
        childIsDir = stat.isDirectory()
      } catch {
        // Skip unreadable entries silently; they shouldn't block the listing.
        continue
      }

      // Defense in depth: never let the response contain anything outside the workspace root.
      const realAbs = await fs.realpath(childAbs).catch(() => childAbs)
      if (hostRoot && !realAbs.startsWith(hostRoot + path.sep) && realAbs !== hostRoot) {
        continue
      }

      collected.push({
        name: entry.name,
        path: childRel,
        kind: childIsDir ? 'directory' : 'file',
        size,
        modifiedAt,
      })
      remaining -= 1

      if (childIsDir && depthRemaining > 0) {
        await walk(childAbs, childRel, depthRemaining - 1)
      }
    }
  }

  await walk(absolutePath, workspaceRelativePath, options.depth - 1)
  return { entries: collected, truncated }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
    actionRequired: 'Grant the openclaw.filesystem permission in Settings -> User Management, then ensure approved filesystem paths are configured in your own Settings.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await context.params
  const workspace = await resolveWorkspace(access.userId, workspaceId)
  if (!workspace) {
    return badRequest('Workspace not found', 'not_found', 404)
  }

  const relativePath = normalizeRelativePath(request.nextUrl.searchParams.get('path'))
  // Empty string is allowed (workspace root); any non-empty path must pass safety.
  if (relativePath && !isPathSafe(relativePath)) {
    return badRequest('Path is not allowed', 'invalid_path', 400, 'Use a workspace-relative path without ".." or absolute segments.')
  }

  const depthRaw = Number.parseInt(request.nextUrl.searchParams.get('depth') ?? '0', 10)
  const depth = Number.isFinite(depthRaw) ? Math.max(0, Math.min(depthRaw, 4)) : 0

  const absolutePath = path.join(workspace.containerPath, relativePath)
  // Path safety double-check: ensure realpath (if it exists) is inside the workspace container.
  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(async () => {
    // If the container path does not yet exist (e.g. empty bind mount before
    // first scaffold), create it and resolve again so the safety check below
    // has a real root to compare against.
    await fs.mkdir(workspace.containerPath, { recursive: true })
    return fs.realpath(workspace.containerPath)
  })
  let realTarget = absolutePath
  try {
    realTarget = await fs.realpath(absolutePath)
  } catch {
    // Allow non-existent paths for read operations that the UI may still try — but reject
    // traversal attempts via realpath of the parent.
    const realParent = await fs.realpath(path.dirname(absolutePath)).catch(() => null)
    if (realParent && !realParent.startsWith(realWorkspaceRoot + path.sep) && realParent !== realWorkspaceRoot) {
      return badRequest(
        `Path is outside the workspace: ${relativePath}`,
        'outside_workspace',
        403,
        `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), parent: ${realParent}`,
      )
    }
    return NextResponse.json(
      buildResponse(workspace, relativePath, [], false),
      { status: 200 }
    )
  }
  if (!realTarget.startsWith(realWorkspaceRoot + path.sep) && realTarget !== realWorkspaceRoot) {
    return badRequest(
      `Path is outside the workspace: ${relativePath}`,
      'outside_workspace',
      403,
      `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), target: ${realTarget}`,
    )
  }

  const CAP = 500
  const { entries, truncated } = await readDirEntries(realTarget, realWorkspaceRoot, relativePath, {
    depth,
    currentDepth: 0,
    cap: CAP,
  })

  return NextResponse.json(buildResponse(workspace, relativePath, entries, truncated))
}

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await context.params
  const workspace = await resolveWorkspace(access.userId, workspaceId)
  if (!workspace) {
    return badRequest('Workspace not found', 'not_found', 404)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Body must be JSON', 'invalid_request', 400)
  }
  if (!body || typeof body !== 'object') {
    return badRequest('Body must be a JSON object', 'invalid_request', 400)
  }
  const { action, path: rawPath, content, createDirectories } = body as Record<string, unknown>

  if (action !== 'mkdir' && action !== 'write') {
    return badRequest('action must be "mkdir" or "write"', 'invalid_request', 400)
  }
  const relativePath = normalizeRelativePath(typeof rawPath === 'string' ? rawPath : '')
  if (!relativePath || !isPathSafe(relativePath)) {
    return badRequest('path is required and must be a workspace-relative path', 'invalid_path', 400)
  }

  const absolutePath = path.join(workspace.containerPath, relativePath)
  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(async () => {
    await fs.mkdir(workspace.containerPath, { recursive: true })
    return fs.realpath(workspace.containerPath)
  })
  const realParent = await fs.realpath(path.dirname(absolutePath)).catch(() => null)
  if (!realParent || (!realParent.startsWith(realWorkspaceRoot + path.sep) && realParent !== realWorkspaceRoot)) {
    return badRequest(
      `Path is outside the workspace: ${relativePath}`,
      'outside_workspace',
      403,
      `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), parent: ${realParent}`,
    )
  }

  // Optional If-Match optimistic concurrency control on writes. The client
  // sends the ETag it loaded; if the server's current ETag differs we
  // reject the write with 412 so the UI can offer a non-destructive merge.
  let currentEtag: string | undefined
  if (action === 'write') {
    try {
      const stat = await fs.stat(absolutePath)
      currentEtag = buildEtag(stat)
      const ifMatch = request.headers.get('if-match')
      if (ifMatch && ifMatch !== currentEtag) {
        return NextResponse.json(
          { error: 'File changed on server', code: 'conflict', currentEtag },
          { status: 412 }
        )
      }
    } catch (error) {
      const code = (error as { code?: string }).code
      // ENOENT is fine — caller is creating a new file. Anything else is a
      // real error to surface.
      if (code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error)
        return badRequest(message, 'internal', 500)
      }
    }
  }

  try {
    if (action === 'mkdir') {
      await fs.mkdir(absolutePath, { recursive: createDirectories === true })
    } else {
      if (typeof content !== 'string') {
        return badRequest('content is required for write', 'invalid_request', 400)
      }
      if (content.length > 2_000_000) {
        return badRequest('File content exceeds the 2 MB limit', 'payload_too_large', 413)
      }
      if (createDirectories === true) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true })
      }
      await fs.writeFile(absolutePath, content, 'utf8')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('EACCES') || message.includes('EPERM')) {
      return badRequest('Filesystem writes are disabled by Settings', 'write_disabled', 403,
        'Enable writes for the managed workspace root in Settings -> WorkSpaces -> Filesystem Writes.')
    }
    return badRequest(message, 'internal', 500)
  }

  publishWorkspaceEvent(workspace.id, {
    kind: action === 'write' ? 'file.modified' : 'file.created',
    path: relativePath,
    at: Date.now(),
  })

  let size: number | undefined
  let modifiedAt: string | undefined
  let newEtag: string | undefined
  try {
    const stat = await fs.stat(absolutePath)
    size = stat.size
    modifiedAt = stat.mtime.toISOString()
    newEtag = buildEtag(stat)
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    entry: {
      path: relativePath,
      kind: action === 'mkdir' ? ('directory' as const) : ('file' as const),
      size,
      modifiedAt,
    },
    ...(newEtag ? { etag: newEtag } : {}),
  }, { status: 201 })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await context.params
  const workspace = await resolveWorkspace(access.userId, workspaceId)
  if (!workspace) {
    return badRequest('Workspace not found', 'not_found', 404)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('Body must be JSON', 'invalid_request', 400)
  }
  if (!body || typeof body !== 'object') {
    return badRequest('Body must be a JSON object', 'invalid_request', 400)
  }
  const { action, from: rawFrom, to: rawTo } = body as Record<string, unknown>

  if (action !== 'rename' && action !== 'move') {
    return badRequest('action must be "rename" or "move"', 'invalid_request', 400)
  }

  const from = normalizeRelativePath(typeof rawFrom === 'string' ? rawFrom : '')
  const to = normalizeRelativePath(typeof rawTo === 'string' ? rawTo : '')
  if (!from || !to || !isPathSafe(from) || !isPathSafe(to)) {
    return badRequest('from and to must be safe workspace-relative paths', 'invalid_path', 400)
  }

  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(async () => {
    await fs.mkdir(workspace.containerPath, { recursive: true })
    return fs.realpath(workspace.containerPath)
  })
  const fromAbs = path.join(workspace.containerPath, from)
  const toAbs = path.join(workspace.containerPath, to)
  const realFrom = await fs.realpath(fromAbs).catch(() => null)
  if (!realFrom || (!realFrom.startsWith(realWorkspaceRoot + path.sep) && realFrom !== realWorkspaceRoot)) {
    return badRequest(
      `Path is outside the workspace: ${from}`,
      'outside_workspace',
      403,
      `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), from: ${realFrom}`,
    )
  }
  const realToParent = await fs.realpath(path.dirname(toAbs)).catch(() => null)
  if (!realToParent || (!realToParent.startsWith(realWorkspaceRoot + path.sep) && realToParent !== realWorkspaceRoot)) {
    return badRequest(
      `Path is outside the workspace: ${to}`,
      'outside_workspace',
      403,
      `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), to parent: ${realToParent}`,
    )
  }

  try {
    await fs.rename(realFrom, toAbs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('EACCES') || message.includes('EPERM')) {
      return badRequest('Filesystem writes are disabled by Settings', 'write_disabled', 403)
    }
    if (message.includes('ENOENT')) {
      return badRequest('Source path does not exist', 'not_found', 404)
    }
    return badRequest(message, 'internal', 500)
  }

  publishWorkspaceEvent(workspace.id, { kind: 'tree.invalidated', at: Date.now() })

  return NextResponse.json({ from, to }, { status: 200 })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await context.params
  const workspace = await resolveWorkspace(access.userId, workspaceId)
  if (!workspace) {
    return badRequest('Workspace not found', 'not_found', 404)
  }

  const relativePath = normalizeRelativePath(request.nextUrl.searchParams.get('path'))
  if (!relativePath || !isPathSafe(relativePath)) {
    return badRequest('path is required and must be a safe workspace-relative path', 'invalid_path', 400)
  }

  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(async () => {
    await fs.mkdir(workspace.containerPath, { recursive: true })
    return fs.realpath(workspace.containerPath)
  })
  const absolutePath = path.join(workspace.containerPath, relativePath)
  const real = await fs.realpath(absolutePath).catch(() => null)
  if (!real || (!real.startsWith(realWorkspaceRoot + path.sep) && real !== realWorkspaceRoot)) {
    return badRequest(
      `Path is outside the workspace: ${relativePath}`,
      'outside_workspace',
      403,
      `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), target: ${real}`,
    )
  }

  const recursive = request.nextUrl.searchParams.get('recursive') === 'true'

  try {
    const stat = await fs.stat(real)
    if (stat.isDirectory()) {
      if (!recursive) {
        return badRequest('Directory is not empty; pass recursive=true to delete', 'invalid_request', 400)
      }
      await fs.rm(real, { recursive: true, force: false })
    } else {
      await fs.unlink(real)
    }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ENOENT') {
      return NextResponse.json({ deleted: false, path: relativePath }, { status: 200 })
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('EACCES') || message.includes('EPERM')) {
      return badRequest('Filesystem writes are disabled by Settings', 'write_disabled', 403)
    }
    return badRequest(message, 'internal', 500)
  }

  publishWorkspaceEvent(workspace.id, { kind: 'file.deleted', path: relativePath, at: Date.now() })

  return NextResponse.json({ deleted: true, path: relativePath }, { status: 200 })
}
