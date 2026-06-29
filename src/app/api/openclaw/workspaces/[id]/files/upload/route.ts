import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getOpenClawWorkspaceById } from '@/lib/openclaw-project-workspaces'
import { publishWorkspaceEvent } from '@/lib/workspace-files-pubsub'
import type { WorkspaceFileEntry, WorkspaceUploadResponse } from '@/lib/workspace-files-types'

export const runtime = 'nodejs'

const REQUIRED_PERMISSIONS = ['openclaw.use', 'openclaw.filesystem'] as const
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB per request
const MAX_FILES_PER_REQUEST = 100

interface RouteContext {
  params: Promise<{ id: string }>
}

function badRequest(error: string, code: string, status = 400, actionRequired?: string) {
  return NextResponse.json({ error, code, ...(actionRequired ? { actionRequired } : {}) }, { status })
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

async function statEntry(absolutePath: string): Promise<WorkspaceFileEntry | null> {
  try {
    const stat = await fs.stat(absolutePath)
    return {
      name: path.basename(absolutePath),
      path: '', // filled by caller
      kind: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Multipart upload endpoint. The client sends a JSON-encoded `paths` form
 * field containing an array of workspace-relative paths (one per file, in
 * order) plus the binary file parts under the `files` field. Each file is
 * written at its target path; intermediate directories are created as
 * needed.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await context.params
  const workspace = await getOpenClawWorkspaceById(access.userId, workspaceId)
  if (!workspace) {
    return badRequest('Workspace not found', 'not_found', 404)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest('Body must be multipart/form-data', 'invalid_request', 400)
  }

  const pathsRaw = form.get('paths')
  if (typeof pathsRaw !== 'string') {
    return badRequest('paths form field is required (JSON string array)', 'invalid_request', 400)
  }

  let rawPaths: unknown
  try {
    rawPaths = JSON.parse(pathsRaw)
  } catch {
    return badRequest('paths form field must be a JSON array of strings', 'invalid_request', 400)
  }
  if (!Array.isArray(rawPaths) || !rawPaths.every(p => typeof p === 'string')) {
    return badRequest('paths must be a JSON array of strings', 'invalid_request', 400)
  }
  if (rawPaths.length > MAX_FILES_PER_REQUEST) {
    return badRequest(`Too many files in one request (max ${MAX_FILES_PER_REQUEST})`, 'payload_too_large', 413)
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length !== rawPaths.length) {
    return badRequest(`paths/files length mismatch (paths=${rawPaths.length}, files=${files.length})`, 'invalid_request', 400)
  }

  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(() => workspace.containerPath)

  const uploaded: WorkspaceFileEntry[] = []

  for (let i = 0; i < rawPaths.length; i += 1) {
    const rawPath = rawPaths[i] as string
    const file = files[i]
    const relativePath = normalizeRelativePath(rawPath)
    if (!relativePath || !isPathSafe(relativePath)) {
      return badRequest(`Invalid upload path: ${rawPath}`, 'invalid_path', 400)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return badRequest(`File ${relativePath} exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`, 'payload_too_large', 413)
    }

    const absolutePath = path.join(workspace.containerPath, relativePath)
    // Defense in depth: the parent directory must be inside the workspace root.
    const realParent = await fs.realpath(path.dirname(absolutePath)).catch(() => null)
    if (!realParent || (!realParent.startsWith(realWorkspaceRoot + path.sep) && realParent !== realWorkspaceRoot)) {
      return badRequest(`Upload target is outside the workspace: ${relativePath}`, 'outside_workspace', 403)
    }

    try {
      await fs.mkdir(realParent, { recursive: true })
      const buffer = Buffer.from(await file.arrayBuffer())
      await fs.writeFile(absolutePath, buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('EACCES') || message.includes('EPERM')) {
        return badRequest('Filesystem writes are disabled by Settings', 'write_disabled', 403,
          'Enable writes for the managed workspace root in Settings -> WorkSpaces -> Filesystem Writes.')
      }
      return badRequest(`Failed to write ${relativePath}: ${message}`, 'internal', 500)
    }

    const entry = await statEntry(absolutePath)
    if (entry) {
      entry.path = relativePath
      uploaded.push(entry)
    }

    publishWorkspaceEvent(workspace.id, { kind: 'file.created', path: relativePath, at: Date.now() })
  }

  const response: WorkspaceUploadResponse = { uploaded }
  return NextResponse.json(response, { status: 201 })
}