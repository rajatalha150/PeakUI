import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getWorkspaceToolWorkspaceById } from '@/lib/workspace-tool-project-workspaces'
import type { WorkspaceFileContent } from '@/lib/workspace-files-types'

export const runtime = 'nodejs'

const REQUIRED_PERMISSIONS = ['workspace-tool.use', 'workspace-tool.filesystem'] as const
const MAX_READ_BYTES = 5_000_000 // 5 MB cap for inline preview

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

function buildEtag(stat: { size: number; mtimeMs: number }): string {
  return `"${stat.size}-${Math.floor(stat.mtimeMs)}"`
}

function detectMimeType(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase()
  switch (ext) {
    case '.md': return 'text/markdown; charset=utf-8'
    case '.txt': return 'text/plain; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.csv': return 'text/csv; charset=utf-8'
    case '.html': return 'text/html; charset=utf-8'
    case '.xml': return 'application/xml; charset=utf-8'
    case '.yml':
    case '.yaml': return 'text/yaml; charset=utf-8'
    case '.ts': return 'text/typescript; charset=utf-8'
    case '.tsx': return 'text/tsx; charset=utf-8'
    case '.js':
    case '.mjs':
    case '.cjs': return 'text/javascript; charset=utf-8'
    case '.jsx': return 'text/jsx; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.py': return 'text/x-python; charset=utf-8'
    case '.sh':
    case '.bash': return 'text/x-shellscript; charset=utf-8'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml; charset=utf-8'
    case '.pdf': return 'application/pdf'
    default: return undefined
  }
}

function looksBinary(buffer: Buffer): boolean {
  // Heuristic: presence of NUL byte in the first 8 KB.
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

export async function GET(request: NextRequest, context: RouteContext) {
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

  const relativePath = normalizeRelativePath(request.nextUrl.searchParams.get('path'))
  // The raw endpoint requires a file path; empty would mean the directory itself.
  if (!relativePath) {
    return NextResponse.json({ error: 'path is required', code: 'invalid_path' }, { status: 400 })
  }
  if (!isPathSafe(relativePath)) {
    return NextResponse.json({ error: 'path must be a safe workspace-relative path', code: 'invalid_path' }, { status: 400 })
  }

  const absolutePath = path.join(workspace.containerPath, relativePath)
  const realWorkspaceRoot = await fs.realpath(workspace.containerPath).catch(async () => {
    await fs.mkdir(workspace.containerPath, { recursive: true })
    return fs.realpath(workspace.containerPath)
  })
  const real = await fs.realpath(absolutePath).catch(() => null)
  if (!real || (!real.startsWith(realWorkspaceRoot + path.sep) && real !== realWorkspaceRoot)) {
    return NextResponse.json(
      {
        error: `Path is outside the workspace: ${relativePath}`,
        code: 'outside_workspace',
        actionRequired: `Workspace root: ${workspace.containerPath} (resolved: ${realWorkspaceRoot}), target: ${real}`,
      },
      { status: 403 }
    )
  }

  const stat = await fs.stat(real)
  if (stat.isDirectory()) {
    return NextResponse.json({ error: 'Path is a directory, not a file', code: 'invalid_path' }, { status: 400 })
  }

  const etag = buildEtag(stat)
  const ifMatch = request.headers.get('if-match')
  if (ifMatch && ifMatch !== etag) {
    return NextResponse.json({ error: 'File changed on server', code: 'conflict', currentEtag: etag }, { status: 412 })
  }

  if (stat.size > MAX_READ_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_READ_BYTES} byte inline preview limit`, code: 'payload_too_large' },
      { status: 413 }
    )
  }

  const buffer = await fs.readFile(real)
  const mimeType = detectMimeType(relativePath)
  const isBinary = looksBinary(buffer) || (mimeType !== undefined && !mimeType.startsWith('text/') && !mimeType.startsWith('image/svg'))

  const body: WorkspaceFileContent = isBinary
    ? {
        path: relativePath,
        encoding: 'base64',
        content: buffer.toString('base64'),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...(mimeType ? { mimeType } : {}),
        etag,
      }
    : {
        path: relativePath,
        encoding: 'utf-8',
        content: buffer.toString('utf8'),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...(mimeType ? { mimeType } : {}),
        etag,
      }

  return NextResponse.json(body, {
    status: 200,
    headers: { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate' },
  })
}
