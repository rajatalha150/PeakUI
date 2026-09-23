import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { bindCoderSessionWorkspace, normalizeCoderFilePath, normalizeCoderWorkspacePath } from '@/lib/coder-authorization'
import {
  hostPathForWorkspaceFile,
  hostRootForWorkspaceFile,
  sanitizeDownloadFilename,
  streamDaemonFileWindowed,
  streamLocalDownload,
} from '@/lib/coder-download'
import { proxyToCoderDaemon } from '@/lib/coder-gateway'

export const runtime = 'nodejs'

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function parsePaths(value: unknown, workspace: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null
  const prefix = `${workspace}/`
  const paths = value.map(path => typeof path === 'string' ? normalizeCoderFilePath(path) : null)
  if (paths.some(path => !path || (path !== workspace && !path.startsWith(prefix)))) return null
  return paths as string[]
}

async function runShell(sessionId: string, command: string, clientId: string) {
  const result = await proxyToCoderDaemon(`/session/${encodeURIComponent(sessionId)}/shell`, {
    method: 'POST', body: { command }, headers: { 'x-qwen-client-id': clientId }, timeoutMs: 120_000,
  })
  if (result.status < 200 || result.status >= 300) throw new Error(result.body || 'Coder command failed')
  const data = JSON.parse(result.body) as { exitCode?: number | null; output?: string; result?: { exitCode?: number | null; output?: string } }
  const exitCode = data.result?.exitCode ?? data.exitCode
  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) throw new Error(data.result?.output || data.output || 'Coder command failed')
}

export async function POST(request: NextRequest) {
  const access = await requireCoderAccess(request)
  if ('response' in access) return access.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.sessionId !== 'string' || typeof body.workspace !== 'string') {
    return NextResponse.json({ error: 'A session and workspace are required.' }, { status: 400 })
  }
  const sessionId = body.sessionId
  const workspace = normalizeCoderWorkspacePath(body.workspace)
  if (!workspace || !await bindCoderSessionWorkspace(access.userId, sessionId, workspace)) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }
  const paths = parsePaths(body.paths, workspace)
  if (!paths) return NextResponse.json({ error: 'Selected paths must stay inside the active workspace.' }, { status: 400 })
  const clientId = request.headers.get('x-qwen-client-id') || ''

  const requireDaemonClient = () => {
    if (clientId) return null
    return NextResponse.json({ error: 'Reconnect to the Coder session before changing workspace files.' }, { status: 409 })
  }

  try {
    if (body.action === 'rename') {
      const missingClient = requireDaemonClient()
      if (missingClient) return missingClient
      const targetName = typeof body.targetName === 'string' ? body.targetName.trim() : ''
      if (paths.length !== 1 || !targetName || /[\\/\x00-\x1f]/.test(targetName) || targetName === '.' || targetName === '..') {
        return NextResponse.json({ error: 'Choose one item and provide a valid name.' }, { status: 400 })
      }
      const source = paths[0]
      const target = `${source.slice(0, source.lastIndexOf('/') + 1)}${targetName}`
      await runShell(sessionId, `test ! -e ${shellQuote(target)} && mv -- ${shellQuote(source)} ${shellQuote(target)}`, clientId)
      return NextResponse.json({ path: target })
    }

    if (body.action === 'delete') {
      const missingClient = requireDaemonClient()
      if (missingClient) return missingClient
      await runShell(sessionId, `rm -rf -- ${paths.map(shellQuote).join(' ')}`, clientId)
      return NextResponse.json({ deleted: paths.length })
    }

    if (body.action === 'download') {
      const isSingleFileDownload = paths.length === 1 && body.archive !== true
      if (isSingleFileDownload) {
        const filename = sanitizeDownloadFilename(paths[0].split('/').pop() || 'download')
        // Stream straight from the shared volume when the workspace is mounted
        // (no size ceiling); otherwise stream validated daemon windows.
        const hostPath = hostPathForWorkspaceFile(paths[0])
        const hostRoot = hostRootForWorkspaceFile(paths[0])
        if (hostPath && hostRoot) return await streamLocalDownload(hostPath, hostRoot, filename)
        return streamDaemonFileWindowed(paths[0], filename)
      }
      const missingClient = requireDaemonClient()
      if (missingClient) return missingClient
      const archive = `${workspace}/.peakui-download-${randomUUID()}.zip`
      const relative = paths.map(path => path.slice(workspace.length + 1))
      await runShell(sessionId, `cd ${shellQuote(workspace)} && zip -q -r ${shellQuote(archive)} -- ${relative.map(shellQuote).join(' ')}`, clientId)
      try {
        const hostPath = hostPathForWorkspaceFile(archive)
        const hostRoot = hostRootForWorkspaceFile(archive)
        const cleanup = () => { void runShell(sessionId, `rm -f -- ${shellQuote(archive)}`, clientId).catch(() => {}) }
        if (hostPath && hostRoot) {
          return await streamLocalDownload(hostPath, hostRoot, 'peakui-download.zip', 'application/zip', cleanup)
        }
        return streamDaemonFileWindowed(archive, 'peakui-download.zip', 'application/zip', cleanup)
      } catch (error) {
        void runShell(sessionId, `rm -f -- ${shellQuote(archive)}`, clientId).catch(() => {})
        throw error
      }
    }
    return NextResponse.json({ error: 'Unknown file action.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'File action failed.' }, { status: 502 })
  }
}
