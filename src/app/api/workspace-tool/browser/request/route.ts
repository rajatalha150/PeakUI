import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import {
  buildWorkspaceToolBrowserApprovalPayload,
  getWorkspaceToolBrowserSession,
  prepareWorkspaceToolBrowserSubmit,
  type WorkspaceToolBrowserRequest,
} from '@/lib/workspace-tool-browser'
import { DEFAULT_SETTINGS, normalizeWorkspaceToolBrowserMode } from '@/lib/settings'
import { createWorkspaceToolApprovalToken } from '@/lib/workspace-tool-tool-approvals'

export const runtime = 'nodejs'

function isBrowserAction(value: unknown): value is WorkspaceToolBrowserRequest['action'] {
  return value === 'open' || value === 'click' || value === 'fill' || value === 'submit' || value === 'extract'
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'workspace-tool.browser'], {
    forbiddenMessage: 'WorkSpaces browser control is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces browser permission in Settings -> User Management, then enable browser control in personal Settings.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await request.json()
    const browserRequest: WorkspaceToolBrowserRequest = {
      action: isBrowserAction(body?.action) ? body.action : 'extract',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : '',
      formIndex: typeof body?.formIndex === 'number' ? body.formIndex : undefined,
      mode: body?.mode,
    }

    if (!isBrowserAction(body?.action)) {
      return NextResponse.json({ error: 'A valid browser action is required' }, { status: 400 })
    }

    if (browserRequest.action !== 'submit') {
      return NextResponse.json({ error: 'Only browser submit actions use approval requests' }, { status: 400 })
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        workspaceToolBrowserMode: true,
      },
    })

    const mode = normalizeWorkspaceToolBrowserMode(
      settings?.workspaceToolBrowserMode ?? DEFAULT_SETTINGS.workspaceToolBrowserMode
    )
    if (mode === 'deny') {
      return NextResponse.json({
        allowed: false,
        reason: 'Browser control is disabled',
      })
    }

    if (mode === 'read-only') {
      return NextResponse.json({
        allowed: false,
        reason: 'Browser mode is read-only, so form submissions are blocked',
      })
    }

    const session = getWorkspaceToolBrowserSession(userId, browserRequest.sessionId)
    const preparation = prepareWorkspaceToolBrowserSubmit(browserRequest, session)

    return NextResponse.json({
      allowed: true,
      requiresApproval: true,
      action: 'submit',
      submitUrl: preparation.submitUrl,
      method: preparation.method,
      fieldCount: Object.keys(preparation.values).length,
      approvalToken: createWorkspaceToolApprovalToken({
        userId,
        tool: 'browser',
        action: 'submit',
        requestPayload: buildWorkspaceToolBrowserApprovalPayload(browserRequest, preparation),
      }),
      description: `Submit browser form ${preparation.formIndex} to ${preparation.submitUrl}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process browser request'
    const status = message.includes('disabled') || message.includes('blocked') ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
