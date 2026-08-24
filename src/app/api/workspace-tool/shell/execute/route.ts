/**
 * POST /api/workspace-tool/shell/execute
 * Execute an approved shell command
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { executeHostCommand, getHostExecutorStatus, type HostExecutorStatus } from '@/lib/workspace-tool-host-executor'
import { createShellAudit, updateShellAudit } from '@/lib/shell-audit'
import {
  executeCommand,
  getShellCommandDecision,
  type ShellExecutionTarget,
  verifyShellApprovalToken,
} from '@/lib/shell-execution'
import { getUserSettings } from '@/lib/settings'

function resolveShellTarget(input: {
  configuredTarget: ShellExecutionTarget
  hostExecutorStatus?: HostExecutorStatus
}): {
  target: ShellExecutionTarget
  targetFallbackReason?: string
} {
  if (input.configuredTarget !== 'host') {
    return { target: 'container' }
  }

  const status = input.hostExecutorStatus
  if (status?.configured && status.reachable) {
    return { target: 'host' }
  }

  if (!status?.configured) {
    return {
      target: 'container',
      targetFallbackReason: 'Host executor is not configured (WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN missing). Command ran in the container instead.',
    }
  }

  return {
    target: 'container',
    targetFallbackReason: `Host executor is unreachable (${status.error || status.url}). Command ran in the container instead.`,
  }
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'workspace-tool.shell'], {
    forbiddenMessage: 'WorkSpaces shell execution is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces shell execution permission in Settings -> User Management, then enable shell execution in personal Settings.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  let effectiveAuditId: string | null = null

  try {
    const body = await request.json()
    const { command, cwd, approvalToken, timeout, sessionId, messageId, description, auditId } = body as {
      command: string
      cwd?: string
      approvalToken?: string
      timeout?: number
      sessionId?: string
      messageId?: string
      description?: string
      auditId?: string
    }

    if (!command || !command.trim()) {
      return NextResponse.json(
        { error: 'Command is required' },
        { status: 400 }
      )
    }

    const settings = await getUserSettings(userId)
  const hostAccessEnabled = settings.workspaceToolHostAccessMode === 'auto-approve'
  const mode = hostAccessEnabled ? 'auto-approve' : settings.shellExecutionMode
  const configuredTarget = settings.shellExecutionTarget
    const allowedCommands = settings.shellAllowedCommands
      ? settings.shellAllowedCommands.split(',').map(c => c.trim()).filter(Boolean)
      : []
    const hostExecutorStatus = configuredTarget === 'host'
      ? await getHostExecutorStatus()
      : undefined
    const { target, targetFallbackReason } = resolveShellTarget({ configuredTarget, hostExecutorStatus })
    const hostAllowedRoots = target === 'host' && settings.shellHostAllowedRoots
      ? settings.shellHostAllowedRoots.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)
      : []
    const hostAllowedEnvVars = target === 'host' && settings.shellHostAllowedEnvVars
      ? settings.shellHostAllowedEnvVars.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)
      : []
    const timeoutMs = typeof timeout === 'number' && timeout > 0
      ? Math.min(timeout, target === 'host' ? settings.shellHostMaxTimeoutMs : 120000)
      : target === 'host'
        ? settings.shellHostMaxTimeoutMs
        : 60000
    const outputLimitBytes = target === 'host' ? settings.shellHostMaxOutputBytes : 1024 * 1024 * 5
    const decision = getShellCommandDecision(command, mode, allowedCommands)

    if (!decision.allowed) {
      await updateShellAudit(auditId, userId, {
        status: 'blocked',
        stderr: decision.reason || 'Command blocked.',
      })
      return NextResponse.json(
        { error: `Command blocked: ${decision.reason}` },
        { status: 403 }
      )
    }

    if (decision.requiresApproval) {
      if (!approvalToken) {
        await updateShellAudit(auditId, userId, {
          status: 'rejected',
          stderr: 'Missing approval token.',
        })
        return NextResponse.json(
          { error: 'Command blocked: Missing approval token' },
          { status: 403 }
        )
      }

      const approvalCheck = verifyShellApprovalToken(approvalToken, { userId, command, cwd })
      if (!approvalCheck.valid) {
        await updateShellAudit(auditId, userId, {
          status: 'rejected',
          stderr: approvalCheck.reason || 'Approval token validation failed.',
        })
        return NextResponse.json(
          { error: `Command blocked: ${approvalCheck.reason}` },
          { status: 403 }
        )
      }
    }

    effectiveAuditId = auditId || await createShellAudit({
      userId,
      sessionId,
      messageId,
      command,
      description,
      cwd,
      target,
      approvalMode: mode,
      status: 'running',
      autoApproved: decision.autoApproved,
      approvalRequired: decision.requiresApproval,
      timeoutMs,
      outputLimitBytes,
      allowedRoots: hostAllowedRoots,
      allowedEnvVars: hostAllowedEnvVars,
    })

    await updateShellAudit(effectiveAuditId || undefined, userId, {
      status: 'running',
      target,
      autoApproved: Boolean(decision.autoApproved),
      approvalRequired: Boolean(decision.requiresApproval),
      timeoutMs,
      outputLimitBytes,
    })

    const result = target === 'host'
      ? await executeHostCommand({
          command,
          cwd,
          timeoutMs,
          maxOutputBytes: outputLimitBytes,
          allowedRoots: hostAllowedRoots,
          allowedEnvNames: hostAllowedEnvVars,
        })
      : await executeCommand(command, {
          cwd,
          timeout: timeoutMs,
        })

    await updateShellAudit(effectiveAuditId || undefined, userId, {
      status: result.success ? 'completed' : 'failed',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.duration,
    })

    return NextResponse.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      duration: result.duration,
      command: result.command,
      target: result.target,
      targetFallbackReason,
      auditId: effectiveAuditId,
    })
  } catch (error) {
    await updateShellAudit(effectiveAuditId || undefined, userId, {
      status: 'failed',
      stderr: error instanceof Error ? error.message : 'Failed to execute command',
    })
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 })
    }
    console.error('[shell/execute] Error:', error)
    return NextResponse.json(
      { error: 'Failed to execute command' },
      { status: 500 }
    )
  }
}
