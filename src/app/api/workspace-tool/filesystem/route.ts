import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import {
  buildWorkspaceToolFilesystemAccessStatus,
  buildWorkspaceToolFilesystemApprovalPayload,
  diagnoseWorkspaceToolFilesystemRequest,
  isWorkspaceToolFilesystemWriteAction,
  runWorkspaceToolFilesystemRequest,
  validateWorkspaceToolFilesystemWriteRequest,
  type WorkspaceToolFilesystemAccessSettings,
  type WorkspaceToolFilesystemAction,
  type WorkspaceToolFilesystemRequest,
} from '@/lib/workspace-tool-filesystem'
import {
  DEFAULT_SETTINGS,
  normalizeWorkspaceToolAllowedPaths,
  normalizeWorkspaceToolFileAccessMode,
  normalizeWorkspaceToolFileWriteMode,
  normalizeWorkspaceToolHostAccessMode,
  normalizeShellExecutionMode,
  normalizeShellExecutionTarget,
  normalizeShellHostAllowedEnvVars,
  normalizeShellHostAllowedRoots,
  normalizeShellHostMaxOutputBytes,
  normalizeShellHostMaxTimeoutMs,
} from '@/lib/settings'
import { verifyWorkspaceToolApprovalToken } from '@/lib/workspace-tool-tool-approvals'
import { getHostExecutorStatus } from '@/lib/workspace-tool-host-executor'

export const runtime = 'nodejs'

const REQUIRED_FILESYSTEM_PERMISSIONS: PermissionKey[] = ['workspace-tool.use', 'workspace-tool.filesystem']

function isFilesystemAction(value: unknown): value is WorkspaceToolFilesystemAction {
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
          error: 'WorkSpaces filesystem permission is not granted for this account.',
          code: 'permission_denied',
          missingPermissions,
          actionRequired: 'An admin must grant the WorkSpaces filesystem permission in Settings -> User Management, then the user must enable approved filesystem paths in their own Settings.',
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

async function loadFilesystemAccessSettings(userId: string): Promise<WorkspaceToolFilesystemAccessSettings> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      workspaceToolFileAccessMode: true,
      workspaceToolAllowedPaths: true,
      workspaceToolFileWriteMode: true,
      workspaceToolWritablePaths: true,
      workspaceToolHostAccessMode: true,
    },
  })

  return {
    workspaceToolFileAccessMode: normalizeWorkspaceToolFileAccessMode(settings?.workspaceToolFileAccessMode ?? DEFAULT_SETTINGS.workspaceToolFileAccessMode),
    workspaceToolAllowedPaths: normalizeWorkspaceToolAllowedPaths(settings?.workspaceToolAllowedPaths ?? DEFAULT_SETTINGS.workspaceToolAllowedPaths),
    workspaceToolFileWriteMode: normalizeWorkspaceToolFileWriteMode(settings?.workspaceToolFileWriteMode ?? DEFAULT_SETTINGS.workspaceToolFileWriteMode),
    workspaceToolWritablePaths: normalizeWorkspaceToolAllowedPaths(settings?.workspaceToolWritablePaths ?? DEFAULT_SETTINGS.workspaceToolWritablePaths),
    workspaceToolHostAccessMode: normalizeWorkspaceToolHostAccessMode(settings?.workspaceToolHostAccessMode ?? DEFAULT_SETTINGS.workspaceToolHostAccessMode),
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
  request?: WorkspaceToolFilesystemRequest
  settings?: WorkspaceToolFilesystemAccessSettings
  approvalTokenPresent?: boolean
}) {
  const diagnostic = input.request && input.settings
    ? diagnoseWorkspaceToolFilesystemRequest(input.request, input.settings, {
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
          filesystem: buildWorkspaceToolFilesystemAccessStatus(input.settings),
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
        shellGranted: authResult.auth.permissions.includes('workspace-tool.shell'),
      },
      filesystem: buildWorkspaceToolFilesystemAccessStatus(accessSettings),
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
        managedWorkspaceHostRoot: DEFAULT_SETTINGS.workspaceToolWritablePaths,
      },
    })
  } catch (error) {
    console.error('[workspace-tool/filesystem] Status error:', error)
    return NextResponse.json(
      { error: 'Failed to load filesystem access status', code: 'filesystem_status_failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireFilesystemAuth()
  if ('response' in authResult) return authResult.response

  let filesystemRequest: WorkspaceToolFilesystemRequest | undefined
  let accessSettings: WorkspaceToolFilesystemAccessSettings | undefined
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

    if (isWorkspaceToolFilesystemWriteAction(action)) {
      const validation = await validateWorkspaceToolFilesystemWriteRequest(filesystemRequest, accessSettings)

      if (accessSettings.workspaceToolFileWriteMode === 'ask-first') {
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

        const approvalCheck = verifyWorkspaceToolApprovalToken(approvalToken, {
          userId: authResult.userId,
          tool: 'filesystem',
          action,
          requestPayload: buildWorkspaceToolFilesystemApprovalPayload(filesystemRequest, validation.path),
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

    const result = await runWorkspaceToolFilesystemRequest(filesystemRequest, accessSettings)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Filesystem request failed'
    const status = statusFromFilesystemError(message)

    if (status === 500) {
      console.error('[workspace-tool/filesystem] Error:', error)
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
