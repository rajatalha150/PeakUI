import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import {
  buildOpenClawFilesystemAccessStatus,
  buildOpenClawFilesystemApprovalPayload,
  diagnoseOpenClawFilesystemRequest,
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
} from '@/lib/settings'
import { createOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'

export const runtime = 'nodejs'

const REQUIRED_FILESYSTEM_PERMISSIONS: PermissionKey[] = ['openclaw.use', 'openclaw.filesystem']

function isFilesystemWriteAction(value: unknown): value is Extract<OpenClawFilesystemAction, 'write' | 'append' | 'mkdir'> {
  return value === 'write' || value === 'append' || value === 'mkdir'
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
          actionRequired: 'An admin must grant the OpenClaw filesystem permission in Settings -> User Management.',
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

function statusFromFilesystemApprovalError(message: string) {
  if (
    message.includes('disabled')
    || message.includes('approved')
    || message.includes('mounted')
    || message.includes('outside')
  ) {
    return 403
  }
  return 400
}

function codeFromFilesystemApprovalRuntimeError(message: string) {
  if (message.includes('limit')) return 'content_limit_exceeded'
  if (message.includes('Parent directory does not exist')) return 'parent_directory_missing'
  return 'filesystem_write_request_failed'
}

function filesystemApprovalErrorPayload(input: {
  message: string
  request?: OpenClawFilesystemRequest
  settings?: OpenClawFilesystemAccessSettings
}) {
  const diagnostic = input.request && input.settings
    ? diagnoseOpenClawFilesystemRequest(input.request, input.settings, { approvalTokenPresent: true })
    : undefined

  return {
    error: input.message,
    code: diagnostic?.allowed
      ? codeFromFilesystemApprovalRuntimeError(input.message)
      : diagnostic?.code || codeFromFilesystemApprovalRuntimeError(input.message),
    actionRequired: diagnostic?.actionRequired,
    diagnostics: input.settings
      ? {
          request: diagnostic,
          filesystem: buildOpenClawFilesystemAccessStatus(input.settings),
        }
      : undefined,
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireFilesystemAuth()
  if ('response' in authResult) return authResult.response

  let filesystemRequest: OpenClawFilesystemRequest | undefined
  let accessSettings: OpenClawFilesystemAccessSettings | undefined

  try {
    const body = await request.json()
    const action = isFilesystemWriteAction(body?.action) ? body.action : null
    const requestedPath = typeof body?.path === 'string' ? body.path.trim() : ''

    if (!action || !requestedPath) {
      return NextResponse.json({ error: 'A valid write action and absolute path are required' }, { status: 400 })
    }

    filesystemRequest = {
      action,
      path: requestedPath,
      ...(typeof body?.content === 'string' ? { content: body.content } : {}),
      ...(body?.createDirectories === true ? { createDirectories: true } : {}),
    }

    accessSettings = await loadFilesystemAccessSettings(authResult.userId)

    const validation = await validateOpenClawFilesystemWriteRequest(filesystemRequest, accessSettings)
    const approvalPayload = buildOpenClawFilesystemApprovalPayload(filesystemRequest, validation.path)

    if (accessSettings.openClawFileWriteMode === 'deny') {
      return NextResponse.json({
        allowed: false,
        reason: 'Filesystem writes are disabled',
      })
    }

    if (accessSettings.openClawFileWriteMode === 'auto-approve') {
      return NextResponse.json({
        allowed: true,
        autoApproved: true,
        action,
        path: validation.path,
        contentBytes: validation.contentBytes,
      })
    }

    return NextResponse.json({
      allowed: true,
      requiresApproval: true,
      action,
      path: validation.path,
      contentBytes: validation.contentBytes,
      approvalToken: createOpenClawApprovalToken({
        userId: authResult.userId,
        tool: 'filesystem',
        action,
        requestPayload: approvalPayload,
      }),
      description: action === 'mkdir'
        ? `Create directory: ${validation.path}`
        : `${action === 'append' ? 'Append text to' : 'Write file'}: ${validation.path}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process filesystem write request'
    const status = statusFromFilesystemApprovalError(message)

    return NextResponse.json(
      filesystemApprovalErrorPayload({
        message,
        request: filesystemRequest,
        settings: accessSettings,
      }),
      { status }
    )
  }
}
