import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { bindCoderSessionWorkspace, normalizeCoderWorkspacePath } from '@/lib/coder-authorization'
import { getCoderDaemonBaseUrl, getCoderDaemonToken } from '@/lib/coder-gateway'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const access = await requireCoderAccess(request)
  if ('response' in access) return access.response

  const sessionId = request.headers.get('x-peakui-session-id') || ''
  const workspace = normalizeCoderWorkspacePath(request.headers.get('x-peakui-workspace') || '')
  const filename = request.headers.get('x-peakui-filename') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) || !workspace || !filename || filename.length > 768 || /[\\/\x00-\x1f\x7f]/.test(filename) || !request.body) {
    return NextResponse.json({ error: 'Valid session, workspace, and filename are required.' }, { status: 400 })
  }
  if (!await bindCoderSessionWorkspace(access.userId, sessionId, workspace)) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  try {
    const upstream = await fetch(`${getCoderDaemonBaseUrl()}/session/${sessionId}/attachment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getCoderDaemonToken()}`,
        'x-peakui-filename': filename,
        ...(request.headers.get('content-type') ? { 'Content-Type': request.headers.get('content-type')! } : {}),
      },
      body: request.body,
      duplex: 'half',
      signal: request.signal,
    } as RequestInit & { duplex: 'half' })
    const result = await upstream.text()
    return new Response(result, { status: upstream.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return NextResponse.json({ error: 'Could not transfer attachment to the coding environment.' }, { status: 502 })
  }
}
