import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { authorizeCoderSession } from '@/lib/coder-authorization'
import { proxyToCoderDaemon } from '@/lib/coder-gateway'

export async function POST(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  const body = await req.json().catch(() => null)
  if (!body || typeof body.sessionId !== 'string' || !await authorizeCoderSession(access.userId, body.sessionId)) {
    return NextResponse.json({ error: 'Coding session not found.' }, { status: 404 })
  }
  const key = createHash('sha256').update(`${access.userId}:${body.sessionId}`).digest('hex')
  const result = await proxyToCoderDaemon('/peakui/browser', {
    method: 'POST', body: { ...body, key }, timeoutMs: 45000,
  })
  return new NextResponse(result.body, { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
