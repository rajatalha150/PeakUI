import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import {
  createAutomationMonitor,
  createAutomationSchedule,
  createAutomationWakeEvent,
  dismissAutomationNotification,
  getAutomationState,
  markAutomationNotificationsSeen,
  updateAutomationMonitor,
  updateAutomationSchedule,
  updateHeartbeatConfig,
  deleteAutomationMonitor,
  deleteAutomationSchedule,
} from '@/lib/openclaw-automation'
import { startOpenClawAutomationWorker } from '@/lib/openclaw-automation-worker'

export const runtime = 'nodejs'

async function requireAutomationAccess() {
  return requireCurrentAuthWithPermissions(['openclaw.use', 'openclaw.automation'], {
    forbiddenMessage: 'OpenClaw automation access is not granted for this account.',
    actionRequired: 'Grant the OpenClaw automation permission in Settings -> User Management before using autonomous scheduling for this user.',
  })
}

export async function GET() {
  const access = await requireAutomationAccess()
  if ('response' in access) return access.response

  try {
    startOpenClawAutomationWorker()
    const state = await getAutomationState(access.userId)
    return NextResponse.json(state)
  } catch (error) {
    console.error('[openclaw/automation] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load automation state', code: 'automation_state_failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const access = await requireAutomationAccess()
  if ('response' in access) return access.response

  try {
    startOpenClawAutomationWorker()
    const body = await request.json()
    const action = typeof body?.action === 'string' ? body.action : ''

    if (action === 'update_heartbeat') {
      const heartbeat = await updateHeartbeatConfig(access.userId, {
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.intervalMinutes === 'number' ? { intervalMinutes: body.intervalMinutes } : {}),
        ...(typeof body.staleAfterMinutes === 'number' ? { staleAfterMinutes: body.staleAfterMinutes } : {}),
        ...(typeof body.promptTemplate === 'string' ? { promptTemplate: body.promptTemplate } : {}),
        ...(body.deliveryMode === 'background-run' ? { deliveryMode: 'background-run' as const } : {}),
        ...(typeof body.targetSessionId === 'string' ? { targetSessionId: body.targetSessionId } : {}),
        ...(typeof body.targetWorkspaceId === 'string' ? { targetWorkspaceId: body.targetWorkspaceId } : {}),
        ...(body.targetSessionId === null ? { targetSessionId: null } : {}),
        ...(body.targetWorkspaceId === null ? { targetWorkspaceId: null } : {}),
      })
      return NextResponse.json({ heartbeat })
    }

    if (action === 'create_schedule') {
      const schedule = await createAutomationSchedule(access.userId, {
        name: typeof body.name === 'string' ? body.name : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        cronExpression: typeof body.cronExpression === 'string' ? body.cronExpression : '',
        timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
        ...(body.deliveryMode === 'background-run' ? { deliveryMode: 'background-run' as const } : {}),
        ...(typeof body.targetSessionId === 'string' ? { targetSessionId: body.targetSessionId } : {}),
        ...(typeof body.targetWorkspaceId === 'string' ? { targetWorkspaceId: body.targetWorkspaceId } : {}),
      })
      return NextResponse.json({ schedule }, { status: 201 })
    }

    if (action === 'update_schedule') {
      const schedule = await updateAutomationSchedule(access.userId, {
        id: typeof body.id === 'string' ? body.id : '',
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
        ...(typeof body.cronExpression === 'string' ? { cronExpression: body.cronExpression } : {}),
        ...(typeof body.timezone === 'string' ? { timezone: body.timezone } : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(body.deliveryMode === 'background-run' ? { deliveryMode: 'background-run' as const } : {}),
        ...(typeof body.targetSessionId === 'string' ? { targetSessionId: body.targetSessionId } : {}),
        ...(typeof body.targetWorkspaceId === 'string' ? { targetWorkspaceId: body.targetWorkspaceId } : {}),
        ...(body.targetSessionId === null ? { targetSessionId: null } : {}),
        ...(body.targetWorkspaceId === null ? { targetWorkspaceId: null } : {}),
      })
      return NextResponse.json({ schedule })
    }

    if (action === 'delete_schedule') {
      await deleteAutomationSchedule(access.userId, typeof body.id === 'string' ? body.id : '')
      return NextResponse.json({ success: true })
    }

    if (action === 'create_monitor') {
      const monitor = await createAutomationMonitor(access.userId, {
        name: typeof body.name === 'string' ? body.name : '',
        kind: body.kind === 'file' ? 'file' : 'url',
        target: typeof body.target === 'string' ? body.target : '',
        ...(typeof body.checkIntervalSeconds === 'number' ? { checkIntervalSeconds: body.checkIntervalSeconds } : {}),
        ...(body.triggerMode === 'contains' || body.triggerMode === 'missing' ? { triggerMode: body.triggerMode } : {}),
        ...(typeof body.expectedPattern === 'string' ? { expectedPattern: body.expectedPattern } : {}),
        ...(body.deliveryMode === 'background-run' ? { deliveryMode: 'background-run' as const } : {}),
        ...(typeof body.targetSessionId === 'string' ? { targetSessionId: body.targetSessionId } : {}),
        ...(typeof body.targetWorkspaceId === 'string' ? { targetWorkspaceId: body.targetWorkspaceId } : {}),
      })
      return NextResponse.json({ monitor }, { status: 201 })
    }

    if (action === 'update_monitor') {
      const monitor = await updateAutomationMonitor(access.userId, {
        id: typeof body.id === 'string' ? body.id : '',
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(body.kind === 'file' || body.kind === 'url' ? { kind: body.kind } : {}),
        ...(typeof body.target === 'string' ? { target: body.target } : {}),
        ...(typeof body.checkIntervalSeconds === 'number' ? { checkIntervalSeconds: body.checkIntervalSeconds } : {}),
        ...(body.triggerMode === 'changed' || body.triggerMode === 'contains' || body.triggerMode === 'missing'
          ? { triggerMode: body.triggerMode }
          : {}),
        ...(typeof body.expectedPattern === 'string' ? { expectedPattern: body.expectedPattern } : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(body.deliveryMode === 'background-run' ? { deliveryMode: 'background-run' as const } : {}),
        ...(typeof body.targetSessionId === 'string' ? { targetSessionId: body.targetSessionId } : {}),
        ...(typeof body.targetWorkspaceId === 'string' ? { targetWorkspaceId: body.targetWorkspaceId } : {}),
        ...(body.targetSessionId === null ? { targetSessionId: null } : {}),
        ...(body.targetWorkspaceId === null ? { targetWorkspaceId: null } : {}),
      })
      return NextResponse.json({ monitor })
    }

    if (action === 'delete_monitor') {
      await deleteAutomationMonitor(access.userId, typeof body.id === 'string' ? body.id : '')
      return NextResponse.json({ success: true })
    }

    if (action === 'dismiss_nudge') {
      const notification = await dismissAutomationNotification(access.userId, typeof body.id === 'string' ? body.id : '')
      return NextResponse.json({ notification })
    }

    if (action === 'create_wake_event') {
      const notification = await createAutomationWakeEvent(access.userId, {
        title: typeof body.title === 'string' ? body.title : '',
        message: typeof body.message === 'string' ? body.message : '',
        ...(typeof body.sessionId === 'string' && body.sessionId.trim() ? { sessionId: body.sessionId.trim() } : {}),
        ...(typeof body.workspaceId === 'string' && body.workspaceId.trim() ? { workspaceId: body.workspaceId.trim() } : {}),
        ...(body.deliveryMode === 'background-run' ? { deliveryMode: 'background-run' as const } : {}),
      })
      return NextResponse.json({ notification }, { status: 201 })
    }

    if (action === 'mark_seen') {
      const ids = Array.isArray(body.ids) ? body.ids.filter((entry: unknown): entry is string => typeof entry === 'string') : []
      await markAutomationNotificationsSeen(access.userId, ids)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { error: 'Unknown automation action', code: 'automation_action_invalid' },
      { status: 400 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Automation request failed'
    return NextResponse.json(
      { error: message, code: 'automation_request_failed' },
      { status: 400 },
    )
  }
}
