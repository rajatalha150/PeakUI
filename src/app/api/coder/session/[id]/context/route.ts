import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { authorizeCoderSession } from '@/lib/coder-authorization'
import { proxyToCoderDaemon } from '@/lib/coder-gateway'
import { normalizeCoderContextUsage } from '@/lib/coder-context'
import { recordNativeContextHandoff } from '@/lib/context-ledger'

export const runtime = 'nodejs'

function daemonError(status: number, body: string) {
  return NextResponse.json({ error: body || 'Coder daemon request failed' }, { status })
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireCoderAccess(_request)
  if ('response' in access) return access.response
  const { id } = await context.params
  if (!id || !await authorizeCoderSession(access.userId, id)) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const result = await proxyToCoderDaemon(`/session/${encodeURIComponent(id)}/context-usage`, { method: 'GET' })
  if (result.status < 200 || result.status >= 300) return daemonError(result.status, result.body)
  try {
    const raw = JSON.parse(result.body)
    const usage = normalizeCoderContextUsage(raw)
    if (!usage) return NextResponse.json({ error: 'Coder daemon returned invalid context usage' }, { status: 502 })
    return NextResponse.json({ usage })
  } catch {
    return NextResponse.json({ error: 'Coder daemon returned invalid context usage' }, { status: 502 })
  }
}

/**
 * Capture Qwen's side-channel recap before native auto-compaction. It neither
 * alters the daemon transcript nor substitutes for its own compaction logic.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireCoderAccess(request)
  if ('response' in access) return access.response
  const { id } = await context.params
  if (!id || !await authorizeCoderSession(access.userId, id)) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const result = await proxyToCoderDaemon(`/session/${encodeURIComponent(id)}/recap`, { method: 'POST', body: {} })
  if (result.status < 200 || result.status >= 300) return daemonError(result.status, result.body)
  let payload: unknown
  try { payload = JSON.parse(result.body) } catch { payload = result.body }
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const summary = typeof payload === 'string'
    ? payload
    : typeof record.recap === 'string'
      ? record.recap
      : typeof record.summary === 'string'
        ? record.summary
        : ''
  if (!summary.trim()) return NextResponse.json({ error: 'Coder daemon returned an empty recap' }, { status: 502 })
  const usageResult = await proxyToCoderDaemon(`/session/${encodeURIComponent(id)}/context-usage`, { method: 'GET' })
  let model = ''
  let tokenEstimate = 0
  try {
    const usage = normalizeCoderContextUsage(JSON.parse(usageResult.body))
    model = usage?.model || ''
    tokenEstimate = usage?.totalTokens || 0
  } catch { /* The recap remains useful if the optional usage refresh failed. */ }
  await recordNativeContextHandoff({ sessionId: id, provider: 'qwen-daemon', model, summary, tokenEstimate })
  return NextResponse.json({ summary: summary.trim(), model, tokenEstimate })
}
