import { NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'
import { getChatSessionById } from '@/lib/chat-sessions'
import { getWorkspaceAgentRun, toWorkspaceAgentRunStatus } from '@/lib/workspace-agent-run'

export const runtime = 'nodejs'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const run = await getWorkspaceAgentRun(auth.user.id, id)
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })
  const session = await getChatSessionById(auth.user.id, run.chatId)
  return NextResponse.json({ run: toWorkspaceAgentRunStatus(run), session })
}
