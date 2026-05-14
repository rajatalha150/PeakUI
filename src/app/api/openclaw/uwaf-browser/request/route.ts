import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserIdWithPermissions } from '@/lib/request-auth'
import { getUwafBrowserSession } from '@/lib/uwaf-browser'
import { createOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'
import { prisma } from '@/lib/prisma'
import { normalizeOpenClawUwafBrowserMode, DEFAULT_SETTINGS } from '@/lib/settings'

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserIdWithPermissions(['openclaw.use', 'openclaw.uwaf'])
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  if (!['submit', 'research_batch'].includes(action)) {
    return NextResponse.json({ error: 'Only submit and research_batch actions require approval requests.' }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const settingsRow = await prisma.userSettings.findUnique({ where: { userId } })
  const mode = settingsRow
    ? normalizeOpenClawUwafBrowserMode(settingsRow.openClawUwafBrowserMode)
    : (DEFAULT_SETTINGS.openClawUwafBrowserMode as 'deny' | 'direct' | 'stealth')

  if (mode === 'deny') {
    return NextResponse.json({ allowed: false, reason: 'UWAF browser is disabled.' })
  }

  const browserMode = typeof body.browserMode === 'string' && ['direct', 'stealth'].includes(body.browserMode)
    ? body.browserMode as 'direct' | 'stealth'
    : 'direct'

  if (action === 'submit') {
    const session = getUwafBrowserSession(userId, sessionId)
    if (!session || !session.currentPage) {
      return NextResponse.json({ allowed: false, reason: 'No active browser session. Open a page first.' })
    }

    const formIndex = typeof body.formIndex === 'number' ? body.formIndex : 0
    const form = session.currentPage.forms[formIndex]
    if (!form) {
      return NextResponse.json({ allowed: false, reason: `Form ${formIndex} not found on the current page.` })
    }

    const payload = {
      action: 'submit',
      sessionId,
      formIndex,
      submitUrl: form.action,
      method: form.method,
      values: session.filledForms[formIndex] || {},
    }

    const approvalToken = createOpenClawApprovalToken({
      userId,
      tool: 'unified_browser',
      action: 'submit',
      requestPayload: payload,
    })

    return NextResponse.json({
      allowed: true,
      requiresApproval: true,
      action: 'submit',
      submitUrl: form.action,
      method: form.method,
      fieldCount: form.fields.length,
      approvalToken,
      description: `Submit form to ${new URL(form.action).hostname} (${form.method}, ${form.fields.length} fields)`,
    })
  }

  if (action === 'research_batch') {
    const url = typeof body.url === 'string' ? body.url : ''
    if (!url) {
      return NextResponse.json({ allowed: false, reason: 'URL is required for research_batch.' })
    }

    const depth = typeof body.depth === 'number' ? body.depth : 1
    const payload = {
      action: 'research_batch',
      sessionId,
      url,
      browserMode,
      depth,
    }

    const approvalToken = createOpenClawApprovalToken({
      userId,
      tool: 'unified_browser',
      action: 'research_batch',
      requestPayload: payload,
    })

    const modeLabel = browserMode === 'stealth' ? 'Stealth (Tor)' : 'Direct'
    return NextResponse.json({
      allowed: true,
      requiresApproval: true,
      action: 'research_batch',
      url,
      depth,
      browserMode,
      approvalToken,
      description: `Research batch: crawl ${url} up to depth ${depth} in ${modeLabel} mode`,
    })
  }

  return NextResponse.json({ allowed: false, reason: 'Unknown action.' })
}
