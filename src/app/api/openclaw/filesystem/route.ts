import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserId } from '@/lib/request-auth'
import {
  buildOpenClawFilesystemApprovalPayload,
  isOpenClawFilesystemWriteAction,
  runOpenClawFilesystemRequest,
  validateOpenClawFilesystemWriteRequest,
  type OpenClawFilesystemAction,
  type OpenClawFilesystemRequest,
} from '@/lib/openclaw-filesystem'
import {
  normalizeOpenClawAllowedPaths,
  normalizeOpenClawFileAccessMode,
  normalizeOpenClawFileWriteMode,
} from '@/lib/settings'
import { verifyOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'

export const runtime = 'nodejs'

function isFilesystemAction(value: unknown): value is OpenClawFilesystemAction {
  return value === 'list'
    || value === 'read'
    || value === 'stat'
    || value === 'write'
    || value === 'append'
    || value === 'mkdir'
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const action = isFilesystemAction(body?.action) ? body.action : null
    const requestedPath = typeof body?.path === 'string' ? body.path.trim() : ''
    const approvalToken = typeof body?.approvalToken === 'string' ? body.approvalToken : undefined

    if (!action || !requestedPath) {
      return NextResponse.json({ error: 'A valid action and absolute path are required' }, { status: 400 })
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

    if (isOpenClawFilesystemWriteAction(action)) {
      const validation = await validateOpenClawFilesystemWriteRequest(filesystemRequest, accessSettings)

      if (accessSettings.openClawFileWriteMode === 'ask-first') {
        if (!approvalToken) {
          return NextResponse.json({ error: 'Filesystem write blocked: Missing approval token' }, { status: 403 })
        }

        const approvalCheck = verifyOpenClawApprovalToken(approvalToken, {
          userId,
          tool: 'filesystem',
          action,
          requestPayload: buildOpenClawFilesystemApprovalPayload(filesystemRequest, validation.path),
        })

        if (!approvalCheck.valid) {
          return NextResponse.json({ error: `Filesystem write blocked: ${approvalCheck.reason}` }, { status: 403 })
        }
      }
    }

    const result = await runOpenClawFilesystemRequest(filesystemRequest, accessSettings)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Filesystem request failed'
    const status = message.includes('disabled')
      || message.includes('approved')
      || message.includes('mounted')
      || message.includes('blocked')
        ? 403
        : message.includes('required')
          || message.includes('binary')
          || message.includes('not a ')
          || message.includes('limit')
            ? 400
            : message.includes('does not exist')
              ? 404
              : 500

    if (status === 500) {
      console.error('[openclaw/filesystem] Error:', error)
    }

    return NextResponse.json({ error: message }, { status })
  }
}
