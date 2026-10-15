import { NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'
import {
  getWorkspaceAgentRunByIdempotencyKey,
  listWorkspaceAgentRuns,
  queueWorkspaceAgentRun,
  toWorkspaceAgentRunStatus,
} from '@/lib/workspace-agent-run'
import { getChatSessionById, upsertChatSession } from '@/lib/chat-sessions'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const chatId = url.searchParams.get('chat_id')?.trim() || undefined
  const runs = await listWorkspaceAgentRuns(auth.user.id, chatId)
  return NextResponse.json({ runs: runs.map(toWorkspaceAgentRunStatus) })
}

export async function POST(req: Request) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.permissions.includes('workspace-tool.use')) {
    return NextResponse.json({ error: 'WorkSpaces access is not granted for this account.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as {
    chat_request?: Record<string, unknown>
    persisted_messages?: unknown[]
    title?: string
    idempotency_key?: string
  } | null
  const chatRequest = body?.chat_request
  const chatId = typeof chatRequest?.chat_id === 'string' ? chatRequest.chat_id.trim() : ''
  if (!chatRequest || !chatId || chatRequest.surface !== 'workspace-tool' || !Array.isArray(body?.persisted_messages)) {
    return NextResponse.json({ error: 'A workspace chat request and persisted message history are required.' }, { status: 400 })
  }

  const existingSession = await getChatSessionById(auth.user.id, chatId)
  if (existingSession && existingSession.surface !== 'workspace-tool') {
    return NextResponse.json({ error: 'That session is not a WorkSpaces session.' }, { status: 409 })
  }

  const idempotencyKey = (body?.idempotency_key || (typeof chatRequest.id === 'string' ? chatRequest.id : '')).trim()
  if (idempotencyKey) {
    const existingRun = await getWorkspaceAgentRunByIdempotencyKey(auth.user.id, idempotencyKey)
    if (existingRun) return NextResponse.json({ runId: existingRun.id, run: toWorkspaceAgentRunStatus(existingRun), reused: true })
  }

  try {
    // Persist the user's turn before handing it to the daemon. This makes the
    // session recoverable even if the browser closes between queueing and the
    // first model event; the daemon will replace this draft with its final
    // transcript when the run completes.
    await upsertChatSession(auth.user.id, {
      id: chatId,
      title: typeof body?.title === 'string' ? body.title : undefined,
      messages: body.persisted_messages,
      surface: 'workspace-tool',
    })
    const run = await queueWorkspaceAgentRun({
      userId: auth.user.id,
      chatRequest,
      persistedMessages: body.persisted_messages,
      title: body.title,
      idempotencyKey,
    })
    return NextResponse.json({ runId: run.id, run: toWorkspaceAgentRunStatus(run) }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not queue WorkSpaces run.' }, { status: 400 })
  }
}
