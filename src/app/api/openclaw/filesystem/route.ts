import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import {
  buildOpenClawFilesystemAccessStatus,
  buildOpenClawFilesystemApprovalPayload,
  diagnoseOpenClawFilesystemRequest,
  isOpenClawFilesystemWriteAction,
  runOpenClawFilesystemRequest,
  validateOpenClawFilesystemWriteRequest,
  type OpenClawFilesystemAccessSettings,
  type OpenClawFilesystemAction,
  type OpenClawFilesystemRequest,
} from '@/lib/openclaw-filesystem'
import {
  DEFAULT_SETTINGS,
  normalizeOpenClawAllowedPaths,
  normalizeOpenClawFileAccessMode,
  normalizeOpenClawFileWriteMode,
  normalizeShellExecutionMode,
  normalizeShellExecutionTarget,
  normalizeShellHostAllowedEnvVars,
  normalizeShellHostAllowedRoots,
  normalizeShellHostMaxOutputBytes,
  normalizeShellHostMaxTimeoutMs,
} from '@/lib/settings'
import { verifyOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'
import { getHostExecutorStatus } from '@/lib/openclaw-host-executor'

export const runtime = 'nodejs'

const REQUIRED_FILESYSTEM_PERMISSIONS: PermissionKey[] = ['openclaw.use', 'openclaw.filesystem']

function isFilesystemAction(value: unknown): value is OpenClawFilesystemAction {
  return value === 'list'
    || value === 'read'
    || value === 'stat'
    || value === 'write'
    || value === 'append'
    || value === 'mkdir'
}

async function requireFilesystemAuth() {
  const auth = await getCurrentAuth()
  if (!auth) {
    return {
      response: NextResponse.json(
        { error: 'Unauthorized', code: 'unauthorized' },
        { status: 401 }
      ),
    }
  }

  const missingPermissions = REQUIRED_FILESYSTEM_PERMISSIONS.filter(permission => !auth.permissions.includes(permission))
  if (missingPermissions.length > 0) {
    return {
      response: NextResponse.json(
        {
          error: 'OpenClaw filesystem permission is not granted for this account.',
          code: 'permission_denied',
          missingPermissions,
          actionRequired: 'An admin must grant the OpenClaw filesystem permission in Settings -> User Management, then the user must enable approved filesystem paths in their own Settings.',
        },
        { status: 403 }
      ),
    }
  }

  return {
    auth,
    userId: auth.user.id,
  }
}

async function loadFilesystemAccessSettings(userId: string): Promise<OpenClawFilesystemAccessSettings> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      openClawFileAccessMode: true,
      openClawAllowedPaths: true,
      openClawFileWriteMode: true,
      openClawWritablePaths: true,
    },
  })

  return {
    openClawFileAccessMode: normalizeOpenClawFileAccessMode(settings?.openClawFileAccessMode ?? DEFAULT_SETTINGS.openClawFileAccessMode),
    openClawAllowedPaths: normalizeOpenClawAllowedPaths(settings?.openClawAllowedPaths ?? DEFAULT_SETTINGS.openClawAllowedPaths),
    openClawFileWriteMode: normalizeOpenClawFileWriteMode(settings?.openClawFileWriteMode ?? DEFAULT_SETTINGS.openClawFileWriteMode),
    openClawWritablePaths: normalizeOpenClawAllowedPaths(settings?.openClawWritablePaths ?? DEFAULT_SETTINGS.openClawWritablePaths),
  }
}

function statusFromFilesystemError(message: string) {
  if (message.includes('does not exist')) return 404
  if (
    message.includes('disabled')
    || message.includes('approved')
    || message.includes('mounted')
    || message.includes('blocked')
    || message.includes('outside')
  ) {
    return 403
  }
  if (
    message.includes('required')
    || message.includes('binary')
    || message.includes('not a ')
    || message.includes('limit')
  ) {
    return 400
  }
  return 500
}

function codeFromFilesystemRuntimeError(message: string) {
  if (message.includes('does not exist')) return 'path_not_found'
  if (message.includes('binary')) return 'binary_file_not_readable'
  if (message.includes('not a directory')) return 'not_a_directory'
  if (message.includes('not a file')) return 'not_a_file'
  if (message.includes('limit')) return 'content_limit_exceeded'
  if (message.includes('Parent directory does not exist')) return 'parent_directory_missing'
  return 'filesystem_request_failed'
}

function filesystemErrorPayload(input: {
  message: string
  request?: OpenClawFilesystemRequest
  settings?: OpenClawFilesystemAccessSettings
  approvalTokenPresent?: boolean
}) {
  const diagnostic = input.request && input.settings
    ? diagnoseOpenClawFilesystemRequest(input.request, input.settings, {
        approvalTokenPresent: input.approvalTokenPresent,
      })
    : undefined

  return {
    error: input.message,
    code: diagnostic?.allowed
      ? codeFromFilesystemRuntimeError(input.message)
      : diagnostic?.code || codeFromFilesystemRuntimeError(input.message),
    actionRequired: diagnostic?.actionRequired,
    diagnostics: input.settings
      ? {
          request: diagnostic,
          filesystem: buildOpenClawFilesystemAccessStatus(input.settings),
        }
      : undefined,
  }
}

export async function GET() {
  const authResult = await requireFilesystemAuth()
  if ('response' in authResult) return authResult.response

  try {
    const [accessSettings, shellSettings, hostExecutorStatus] = await Promise.all([
      loadFilesystemAccessSettings(authResult.userId),
      prisma.userSettings.findUnique({
        where: { userId: authResult.userId },
        select: {
          shellExecutionTarget: true,
          shellExecutionMode: true,
          shellHostAllowedRoots: true,
          shellHostAllowedEnvVars: true,
          shellHostMaxTimeoutMs: true,
          shellHostMaxOutputBytes: true,
        },
      }),
      getHostExecutorStatus(),
    ])

    return NextResponse.json({
      permissions: {
        role: authResult.auth.user.role,
        required: REQUIRED_FILESYSTEM_PERMISSIONS,
        shellGranted: authResult.auth.permissions.includes('openclaw.shell'),
      },
      filesystem: buildOpenClawFilesystemAccessStatus(accessSettings),
      shell: {
        target: normalizeShellExecutionTarget(shellSettings?.shellExecutionTarget),
        mode: normalizeShellExecutionMode(shellSettings?.shellExecutionMode),
        hostAllowedRoots: normalizeShellHostAllowedRoots(shellSettings?.shellHostAllowedRoots).split(/\r?\n/).filter(Boolean),
        hostAllowedEnvVars: normalizeShellHostAllowedEnvVars(shellSettings?.shellHostAllowedEnvVars).split(/\r?\n/).filter(Boolean),
        hostMaxTimeoutMs: normalizeShellHostMaxTimeoutMs(shellSettings?.shellHostMaxTimeoutMs),
        hostMaxOutputBytes: normalizeShellHostMaxOutputBytes(shellSettings?.shellHostMaxOutputBytes),
        hostExecutorStatus,
      },
      defaults: {
        managedWorkspaceHostRoot: DEFAULT_SETTINGS.openClawWritablePaths,
      },
    })
  } catch (error) {
    console.error('[openclaw/filesystem] Status error:', error)
    return NextResponse.json(
      { error: 'Failed to load filesystem access status', code: 'filesystem_status_failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireFilesystemAuth()
  if ('response' in authResult) return authResult.response

  let filesystemRequest: OpenClawFilesystemRequest | undefined
  let accessSettings: OpenClawFilesystemAccessSettings | undefined
  let approvalTokenPresent = false

  try {
    const body = await request.json()
    const action = isFilesystemAction(body?.action) ? body.action : null
    const requestedPath = typeof body?.path === 'string' ? body.path.trim() : ''
    const approvalToken = typeof body?.approvalToken === 'string' ? body.approvalToken : undefined
    approvalTokenPresent = Boolean(approvalToken)

    if (!action || !requestedPath) {
      return NextResponse.json({ error: 'A valid action and absolute path are required' }, { status: 400 })
    }

    filesystemRequest = {
      action,
      path: requestedPath,
      ...(typeof body?.content === 'string' ? { content: body.content } : {}),
      ...(body?.createDirectories === true ? { createDirectories: true } : {}),
    }

    accessSettings = await loadFilesystemAccessSettings(authResult.userId)

    if (isOpenClawFilesystemWriteAction(action)) {
      const validation = await validateOpenClawFilesystemWriteRequest(filesystemRequest, accessSettings)

      if (accessSettings.openClawFileWriteMode === 'ask-first') {
        if (!approvalToken) {
          return NextResponse.json(
            filesystemErrorPayload({
              message: 'Filesystem write blocked: Missing approval token',
              request: filesystemRequest,
              settings: accessSettings,
              approvalTokenPresent,
            }),
            { status: 403 }
          )
        }

        const approvalCheck = verifyOpenClawApprovalToken(approvalToken, {
          userId: authResult.userId,
          tool: 'filesystem',
          action,
          requestPayload: buildOpenClawFilesystemApprovalPayload(filesystemRequest, validation.path),
        })

        if (!approvalCheck.valid) {
          return NextResponse.json(
            filesystemErrorPayload({
              message: `Filesystem write blocked: ${approvalCheck.reason}`,
              request: filesystemRequest,
              settings: accessSettings,
              approvalTokenPresent,
            }),
            { status: 403 }
          )
        }
      }
    }

    const result = await runOpenClawFilesystemRequest(filesystemRequest, accessSettings)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Filesystem request failed'
    const status = statusFromFilesystemError(message)

    if (status === 500) {
      console.error('[openclaw/filesystem] Error:', error)
    }

    return NextResponse.json(
      filesystemErrorPayload({
        message,
        request: filesystemRequest,
        settings: accessSettings,
        approvalTokenPresent,
      }),
      { status }
    )
  }
}
