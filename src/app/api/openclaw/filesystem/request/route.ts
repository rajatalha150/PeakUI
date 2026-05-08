import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserId } from '@/lib/request-auth'
import {
  buildOpenClawFilesystemApprovalPayload,
  validateOpenClawFilesystemWriteRequest,
  type OpenClawFilesystemAction,
  type OpenClawFilesystemRequest,
} from '@/lib/openclaw-filesystem'
import {
  normalizeOpenClawAllowedPaths,
  normalizeOpenClawFileAccessMode,
  normalizeOpenClawFileWriteMode,
} from '@/lib/settings'
import { createOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'

export const runtime = 'nodejs'

function isFilesystemWriteAction(value: unknown): value is Extract<OpenClawFilesystemAction, 'write' | 'append' | 'mkdir'> {
  return value === 'write' || value === 'append' || value === 'mkdir'
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const action = isFilesystemWriteAction(body?.action) ? body.action : null
    const requestedPath = typeof body?.path === 'string' ? body.path.trim() : ''

    if (!action || !requestedPath) {
      return NextResponse.json({ error: 'A valid write action and absolute path are required' }, { status: 400 })
    }

    const filesystemRequest: OpenClawFilesystemRequest = {
      action,
      path: requestedPath,
      ...(typeof body?.content === 'string' ? { content: body.content } : {}),
      ...(body?.createDirectories === true ? { createDirectories: true } : {}),
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        openClawFileAccessMode: true,
        openClawAllowedPaths: true,
        openClawFileWriteMode: true,
        openClawWritablePaths: true,
      },
    })

    const accessSettings = {
      openClawFileAccessMode: normalizeOpenClawFileAccessMode(settings?.openClawFileAccessMode),
      openClawAllowedPaths: normalizeOpenClawAllowedPaths(settings?.openClawAllowedPaths),
      openClawFileWriteMode: normalizeOpenClawFileWriteMode(settings?.openClawFileWriteMode),
      openClawWritablePaths: normalizeOpenClawAllowedPaths(settings?.openClawWritablePaths),
    }

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
        userId,
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
    const status = message.includes('disabled') || message.includes('approved') || message.includes('mounted')
      ? 403
      : 400

    return NextResponse.json({ error: message }, { status })
  }
}
