import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createAutomationWakeEvent } from '@/lib/workspace-tool-automation'
import { startWorkspaceToolAutomationWorker } from '@/lib/workspace-tool-automation-worker'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'workspace-tool.automation'], {
    forbiddenMessage: 'WorkSpaces automation access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces automation permission in Settings -> User Management before sending wake events for this user.',
  })
  if ('response' in access) return access.response

  try {
    startWorkspaceToolAutomationWorker()
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' ? body.title : ''
    const message = typeof body?.message === 'string' ? body.message : ''
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined
    const workspaceId = typeof body?.workspaceId === 'string' && body.workspaceId.trim() ? body.workspaceId.trim() : undefined
    const deliveryMode = body?.deliveryMode === 'background-run' ? 'background-run' : undefined

    const notification = await createAutomationWakeEvent(access.userId, {
      title,
      message,
      sessionId,
      workspaceId,
      deliveryMode,
    })

    return NextResponse.json({ notification }, { status: 201 })
  } catch (error) {
    console.error('[workspace-tool/automation/wake-event] POST error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create wake event',
        code: 'automation_wake_event_failed',
      },
      { status: 400 },
    )
  }
}
