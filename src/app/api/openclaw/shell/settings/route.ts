/**
 * POST /api/openclaw/shell/settings
 * Update shell execution settings
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getHostExecutorStatus } from '@/lib/openclaw-host-executor'
import {
  DEFAULT_SETTINGS,
  normalizeShellExecutionMode,
  normalizeShellExecutionTarget,
  normalizeShellHostAllowedEnvVars,
  normalizeShellHostAllowedRoots,
  normalizeShellHostMaxOutputBytes,
  normalizeShellHostMaxTimeoutMs,
  type ShellExecutionMode,
  type ShellExecutionTarget,
} from '@/lib/settings'

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'openclaw.shell'], {
    forbiddenMessage: 'WorkSpaces shell execution is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces shell execution permission in Settings -> User Management before editing shell settings for this user.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await request.json()
    const {
      shellExecutionTarget,
      shellExecutionMode,
      shellAllowedCommands,
      shellHostAllowedRoots,
      shellHostAllowedEnvVars,
      shellHostMaxTimeoutMs,
      shellHostMaxOutputBytes,
    } = body as {
      shellExecutionTarget?: ShellExecutionTarget
      shellExecutionMode?: ShellExecutionMode
      shellAllowedCommands?: string
      shellHostAllowedRoots?: string
      shellHostAllowedEnvVars?: string
      shellHostMaxTimeoutMs?: number
      shellHostMaxOutputBytes?: number
    }

    const updateData: Record<string, string | number> = {}
    if (shellExecutionTarget !== undefined) {
      updateData.shellExecutionTarget = normalizeShellExecutionTarget(shellExecutionTarget)
    }
    if (shellExecutionMode !== undefined) {
      updateData.shellExecutionMode = normalizeShellExecutionMode(shellExecutionMode)
    }
    if (shellAllowedCommands !== undefined) {
      updateData.shellAllowedCommands = shellAllowedCommands
    }
    if (shellHostAllowedRoots !== undefined) {
      updateData.shellHostAllowedRoots = normalizeShellHostAllowedRoots(shellHostAllowedRoots)
    }
    if (shellHostAllowedEnvVars !== undefined) {
      updateData.shellHostAllowedEnvVars = normalizeShellHostAllowedEnvVars(shellHostAllowedEnvVars)
    }
    if (shellHostMaxTimeoutMs !== undefined) {
      updateData.shellHostMaxTimeoutMs = normalizeShellHostMaxTimeoutMs(shellHostMaxTimeoutMs)
    }
    if (shellHostMaxOutputBytes !== undefined) {
      updateData.shellHostMaxOutputBytes = normalizeShellHostMaxOutputBytes(shellHostMaxOutputBytes)
    }

    await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...DEFAULT_SETTINGS,
        ...updateData,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[shell/settings] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update shell settings' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/openclaw/shell/settings
 * Get current shell execution settings
 */

export async function GET() {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'openclaw.shell'], {
    forbiddenMessage: 'WorkSpaces shell execution is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces shell execution permission in Settings -> User Management before accessing shell settings for this user.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const hostExecutorStatus = await getHostExecutorStatus()
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        shellExecutionTarget: true,
        shellExecutionMode: true,
        shellAllowedCommands: true,
        shellHostAllowedRoots: true,
        shellHostAllowedEnvVars: true,
        shellHostMaxTimeoutMs: true,
        shellHostMaxOutputBytes: true,
      },
    })

    return NextResponse.json({
      shellExecutionTarget: settings?.shellExecutionTarget || DEFAULT_SETTINGS.shellExecutionTarget,
      shellExecutionMode: settings?.shellExecutionMode || 'ask-first',
      shellAllowedCommands: settings?.shellAllowedCommands || '',
      shellHostAllowedRoots: settings?.shellHostAllowedRoots || DEFAULT_SETTINGS.shellHostAllowedRoots,
      shellHostAllowedEnvVars: settings?.shellHostAllowedEnvVars || DEFAULT_SETTINGS.shellHostAllowedEnvVars,
      shellHostMaxTimeoutMs: settings?.shellHostMaxTimeoutMs || DEFAULT_SETTINGS.shellHostMaxTimeoutMs,
      shellHostMaxOutputBytes: settings?.shellHostMaxOutputBytes || DEFAULT_SETTINGS.shellHostMaxOutputBytes,
      hostExecutorStatus,
    })
  } catch (error) {
    console.error('[shell/settings] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get shell settings' },
      { status: 500 }
    )
  }
}
