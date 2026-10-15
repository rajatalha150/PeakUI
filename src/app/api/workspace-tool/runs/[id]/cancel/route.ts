import { NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'
import { getWorkspaceAgentRun } from '@/lib/workspace-agent-run'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const run = await getWorkspaceAgentRun(auth.user.id, id)
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })
  if (!['succeeded', 'failed', 'cancelled'].includes(run.status)) {
    await prisma.workspaceAgentRun.update({
      where: { id: run.id },
      data: { status: 'cancelled', completedAt: new Date(), error: 'Cancelled by the user.' },
    })
  }
  return NextResponse.json({ success: true, status: 'cancelled' })
}
