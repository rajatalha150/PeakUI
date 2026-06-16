import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import {
  buildOpenClawBrowserApprovalPayload,
  getOpenClawBrowserSession,
  prepareOpenClawBrowserSubmit,
  runOpenClawBrowserAction,
  type OpenClawBrowserRequest,
} from '@/lib/openclaw-browser'
import { DEFAULT_SETTINGS, normalizeOpenClawBrowserMode } from '@/lib/settings'
import { verifyOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'

export const runtime = 'nodejs'

function isBrowserAction(value: unknown): value is OpenClawBrowserRequest['action'] {
  return value === 'open' || value === 'click' || value === 'fill' || value === 'submit' || value === 'extract'
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'openclaw.browser'], {
    forbiddenMessage: 'WorkSpaces browser control is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces browser permission in Settings -> User Management, then enable browser control in personal Settings.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await request.json()
    const approvalToken = typeof body?.approvalToken === 'string' ? body.approvalToken : undefined
    const browserRequest: OpenClawBrowserRequest = {
      action: isBrowserAction(body?.action) ? body.action : 'extract',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : '',
      url: typeof body?.url === 'string' ? body.url : undefined,
      linkIndex: typeof body?.linkIndex === 'number' ? body.linkIndex : undefined,
      linkText: typeof body?.linkText === 'string' ? body.linkText : undefined,
      formIndex: typeof body?.formIndex === 'number' ? body.formIndex : undefined,
      values: body?.values && typeof body.values === 'object' && !Array.isArray(body.values)
        ? Object.fromEntries(
            Object.entries(body.values)
              .filter(([, value]) => typeof value === 'string')
              .map(([key, value]) => [key, String(value)])
          )
        : undefined,
      mode: body?.mode,
    }

    if (!isBrowserAction(body?.action)) {
      return NextResponse.json({ error: 'A valid browser action is required' }, { status: 400 })
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        openClawBrowserMode: true,
      },
    })

    const mode = normalizeOpenClawBrowserMode(
      settings?.openClawBrowserMode ?? DEFAULT_SETTINGS.openClawBrowserMode
    )
    if (browserRequest.action === 'submit' && mode === 'ask-first') {
      if (!approvalToken) {
        return NextResponse.json({ error: 'Browser submit blocked: Missing approval token' }, { status: 403 })
      }

      const session = getOpenClawBrowserSession(userId, browserRequest.sessionId)
      const preparation = prepareOpenClawBrowserSubmit(browserRequest, session)
      const approvalCheck = verifyOpenClawApprovalToken(approvalToken, {
        userId,
        tool: 'browser',
        action: 'submit',
        requestPayload: buildOpenClawBrowserApprovalPayload(browserRequest, preparation),
      })

      if (!approvalCheck.valid) {
        return NextResponse.json({ error: `Browser submit blocked: ${approvalCheck.reason}` }, { status: 403 })
      }
    }

    const result = await runOpenClawBrowserAction(userId, browserRequest, {
      openClawBrowserMode: mode,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser action failed'
    const status = message.includes('disabled') || message.includes('blocked')
      ? 403
      : 400

    return NextResponse.json({ error: message }, { status })
  }
}
