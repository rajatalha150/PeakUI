import { NextRequest, NextResponse } from 'next/server'
import { promises as fs, createReadStream } from 'fs'
import path from 'path'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getWorkspaceToolWorkspaceById } from '@/lib/workspace-tool-project-workspaces'

export const runtime = 'nodejs'

const REQUIRED_PERMISSIONS = ['workspace-tool.use', 'workspace-tool.filesystem'] as const
const MAX_STREAM_BYTES = 200 * 1024 * 1024 // 200 MB cap per individual download

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
    case '.zip': return 'application/zip'
    case '.eml': return 'message/rfc822'
    case '.ics': return 'text/calendar; charset=utf-8'
    default: return undefined
  }
}

/**
 * Streams a single workspace file as an attachment download. Text files are
 * returned as utf-8; binary files (or anything with a registered mime type
 * outside the text/* tree) are streamed as raw bytes with a matching
 * Content-Type and Content-Disposition: attachment.
 */
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
  if (!relativePath || !isPathSafe(relativePath)) {
    return NextResponse.json({ error: 'path is required and must be safe', code: 'invalid_path' }, { status: 400 })
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
  if (stat.size > MAX_STREAM_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_STREAM_BYTES / 1024 / 1024} MB download limit`, code: 'payload_too_large' },
      { status: 413 }
    )
  }

  const mimeType = detectMimeType(path.basename(real))
  const baseName = path.basename(real)
  // RFC 5987-ish filename encoding: ASCII fallback plus UTF-8 percent-encoded
  // for non-ASCII characters. Modern browsers all support this.
  const asciiFallback = baseName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  const utf8Name = encodeURIComponent(baseName)

  const headers: Record<string, string> = {
    'Content-Length': String(stat.size),
    'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`,
    'Cache-Control': 'private, max-age=0, must-revalidate',
  }
  if (mimeType) headers['Content-Type'] = mimeType

  const stream = createReadStream(real)
  // Node Readable streams are iterable as Web ReadableStreams in Node 18+,
  // which is the runtime declared above. The cast is the same pattern used
  // by the zip route.
  return new NextResponse(stream as unknown as ReadableStream, { headers })
}