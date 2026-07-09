/**
 * POST /api/openclaw/shell/request
 * Request approval for a shell command (ask-first mode)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createShellAudit } from '@/lib/shell-audit'
import { getHostExecutorStatus, type HostExecutorStatus } from '@/lib/openclaw-host-executor'
import { getUserSettings } from '@/lib/settings'
import { createShellApprovalToken, getShellCommandDecision, type ShellExecutionTarget } from '@/lib/shell-execution'

function resolveShellTarget(input: {
  configuredTarget: ShellExecutionTarget
  hostExecutorStatus?: HostExecutorStatus
}): {
  target: ShellExecutionTarget
  fallbackReason?: string
} {
  if (input.configuredTarget !== 'host') {
    return { target: 'container' }
  }

  const status = input.hostExecutorStatus
  if (status?.configured && status.reachable) {
    return { target: 'host' }
  }

  return {
    target: 'container',
    fallbackReason: status?.error || 'Host executor is not available; using the container shell instead.',
  }
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'openclaw.shell'], {
    forbiddenMessage: 'WorkSpaces shell execution is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces shell execution permission in Settings -> User Management, then enable shell execution in personal Settings.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await request.json()
    const { command, cwd, description, sessionId, messageId } = body as {
      command: string
      cwd?: string
      description?: string
      sessionId?: string
      messageId?: string
    }

    if (!command || !command.trim()) {
      return NextResponse.json(
        { error: 'Command is required' },
        { status: 400 }
      )
    }

    const settings = await getUserSettings(userId)
  const hostAccessEnabled = settings.openClawHostAccessMode === 'auto-approve'
  const mode = hostAccessEnabled ? 'auto-approve' : settings.shellExecutionMode
  const configuredTarget = settings.shellExecutionTarget
    const allowedCommands = settings.shellAllowedCommands
      ? settings.shellAllowedCommands.split(',').map(c => c.trim()).filter(Boolean)
      : []
    const hostExecutorStatus = configuredTarget === 'host'
      ? await getHostExecutorStatus()
      : undefined
    const { target, fallbackReason } = resolveShellTarget({ configuredTarget, hostExecutorStatus })
    const hostAllowedRoots = target === 'host' && settings.shellHostAllowedRoots
      ? settings.shellHostAllowedRoots.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)
      : []
    const hostAllowedEnvVars = target === 'host' && settings.shellHostAllowedEnvVars
      ? settings.shellHostAllowedEnvVars.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)
      : []
    const timeoutMs = target === 'host' ? settings.shellHostMaxTimeoutMs : 60000
    const outputLimitBytes = target === 'host' ? settings.shellHostMaxOutputBytes : 1024 * 1024 * 5
    const decision = getShellCommandDecision(command, mode, allowedCommands)

    if (!decision.allowed) {
      const auditId = await createShellAudit({
        userId,
        sessionId,
        messageId,
        command,
        description,
        cwd,
        target,
        approvalMode: mode,
        status: 'blocked',
        timeoutMs,
        outputLimitBytes,
        allowedRoots: hostAllowedRoots,
        allowedEnvVars: hostAllowedEnvVars,
      })

      return NextResponse.json({
        allowed: false,
        reason: decision.reason,
        command,
        parsed: decision.parsed,
        target,
        auditId,
        fallbackReason,
      })
    }

    const auditId = await createShellAudit({
      userId,
      sessionId,
      messageId,
      command,
      description,
      cwd,
      target,
      approvalMode: mode,
      status: decision.autoApproved ? 'auto-approved' : 'awaiting-approval',
      autoApproved: decision.autoApproved,
      approvalRequired: decision.requiresApproval,
      timeoutMs,
      outputLimitBytes,
      allowedRoots: hostAllowedRoots,
      allowedEnvVars: hostAllowedEnvVars,
    })

    if (decision.autoApproved) {
      return NextResponse.json({
        allowed: true,
        autoApproved: true,
        command,
        parsed: decision.parsed,
        target,
        auditId,
        description: description || `Run: ${command}`,
        fallbackReason,
      })
    }

    return NextResponse.json({
      allowed: true,
      requiresApproval: true,
      command,
      parsed: decision.parsed,
      target,
      auditId,
      approvalToken: createShellApprovalToken({ userId, command, cwd }),
      description: description || `Run: ${command}`,
      reason: decision.reason,
      fallbackReason,
    })
  } catch (error) {
    console.error('[shell/request] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process command request' },
      { status: 500 }
    )
  }
}
