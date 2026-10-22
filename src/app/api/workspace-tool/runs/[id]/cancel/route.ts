import { NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'
import { cancelWorkspaceAgentRun, toWorkspaceAgentRunStatus } from '@/lib/workspace-agent-run'

export const runtime = 'nodejs'

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const run = await cancelWorkspaceAgentRun(auth.user.id, id)
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })
  return NextResponse.json({ success: true, run: toWorkspaceAgentRunStatus(run) })
}
