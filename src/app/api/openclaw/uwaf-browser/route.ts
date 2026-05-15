import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserIdWithPermissions } from '@/lib/request-auth'
import { runUwafBrowserAction, getUwafBrowserSession, type UwafBrowserRequest } from '@/lib/uwaf-browser'
import { isBrowserInterrupted, restartScreencastForSession } from '@/lib/live-browser-server'
import { prisma } from '@/lib/prisma'
import { normalizeOpenClawUwafBrowserMode, normalizeOpenClawUwafDefaultMode, normalizeBoolean, DEFAULT_SETTINGS } from '@/lib/settings'

const VALID_ACTIONS: UwafBrowserRequest['action'][] = [
  'search',
  'open',
  'click',
  'type',
  'press',
  'wait_for_selector',
  'scroll',
  'back',
  'forward',
  'new_tab',
  'list_tabs',
  'switch_tab',
  'close_tab',
  'select',
  'hover',
  'extract',
  'extract_table',
  'research_batch',
  'fill',
  'submit',
]

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
  if (!VALID_ACTIONS.includes(action as UwafBrowserRequest['action'])) {
    return NextResponse.json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const settingsRow = await prisma.userSettings.findUnique({ where: { userId } })
  const settings = settingsRow ? {
    openClawUwafBrowserMode: normalizeOpenClawUwafBrowserMode(settingsRow.openClawUwafBrowserMode),
    openClawUwafScreenshots: settingsRow.openClawUwafScreenshots ?? DEFAULT_SETTINGS.openClawUwafScreenshots,
    openClawUwafDefaultMode: normalizeOpenClawUwafDefaultMode(settingsRow.openClawUwafDefaultMode),
  } : {
    openClawUwafBrowserMode: DEFAULT_SETTINGS.openClawUwafBrowserMode as 'deny' | 'direct' | 'stealth',
    openClawUwafScreenshots: DEFAULT_SETTINGS.openClawUwafScreenshots,
    openClawUwafDefaultMode: DEFAULT_SETTINGS.openClawUwafDefaultMode as 'direct' | 'stealth',
  }

  if (settings.openClawUwafBrowserMode === 'deny') {
    return NextResponse.json({ error: 'UWAF browser is disabled. Enable it in Settings.' }, { status: 403 })
  }

  const requestBrowserMode = typeof body.browserMode === 'string' && ['direct', 'stealth'].includes(body.browserMode)
    ? body.browserMode as 'direct' | 'stealth'
    : settings.openClawUwafDefaultMode

  if (action === 'submit') {
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken : ''
    if (!approvalToken) {
      return NextResponse.json({ error: 'Approval token required for submit actions.' }, { status: 403 })
    }

    const { verifyOpenClawApprovalToken } = await import('@/lib/openclaw-tool-approvals')
    const session = getUwafBrowserSession(userId, sessionId, requestBrowserMode)
    if (!session) {
      return NextResponse.json({ error: 'No active browser session for this submit request.' }, { status: 400 })
    }

    const formIndex = typeof body.formIndex === 'number' ? body.formIndex : 0
    const currentUrl = session.currentPage?.url || ''
    const currentForms = session.currentPage?.forms || []
    const form = currentForms[formIndex]

    const payload = {
      action: 'submit',
      sessionId,
      formIndex,
      submitUrl: form?.action || currentUrl,
      method: form?.method || 'GET',
      values: session.filledForms[formIndex] || {},
    }

    const verification = verifyOpenClawApprovalToken(approvalToken, {
      userId,
      tool: 'unified_browser' as const,
      action: 'submit',
      requestPayload: payload,
    })

    if (!verification.valid) {
      return NextResponse.json({ error: verification.reason || 'Invalid approval token' }, { status: 403 })
    }
  }

  if (action === 'research_batch') {
    const approvalToken = typeof body.approvalToken === 'string' ? body.approvalToken : ''
    if (!approvalToken) {
      return NextResponse.json({ error: 'Approval token required for research_batch actions.' }, { status: 403 })
    }

    const { verifyOpenClawApprovalToken } = await import('@/lib/openclaw-tool-approvals')
    const payload = {
      action: 'research_batch',
      sessionId,
      url: typeof body.url === 'string' ? body.url : '',
      browserMode: requestBrowserMode,
    }

    const verification = verifyOpenClawApprovalToken(approvalToken, {
      userId,
      tool: 'unified_browser' as const,
      action: 'research_batch',
      requestPayload: payload,
    })

    if (!verification.valid) {
      return NextResponse.json({ error: verification.reason || 'Invalid approval token' }, { status: 403 })
    }
  }

  const uwafRequest: UwafBrowserRequest = {
    action: action as UwafBrowserRequest['action'],
    sessionId,
  }

  if (typeof body.query === 'string' && body.query.trim()) uwafRequest.query = body.query.trim()
  if (typeof body.url === 'string' && body.url.trim()) uwafRequest.url = body.url.trim()
  if (typeof body.linkIndex === 'number' && Number.isInteger(body.linkIndex) && body.linkIndex >= 0) uwafRequest.linkIndex = body.linkIndex
  if (typeof body.linkText === 'string' && body.linkText.trim()) uwafRequest.linkText = body.linkText.trim()
  if (typeof body.formIndex === 'number' && Number.isInteger(body.formIndex) && body.formIndex >= 0) uwafRequest.formIndex = body.formIndex
  if (body.values && typeof body.values === 'object' && !Array.isArray(body.values)) {
    uwafRequest.values = Object.fromEntries(
      Object.entries(body.values as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, (v as string).trim()])
        .filter(([, v]) => v.length > 0)
    )
  }
  if (typeof body.mode === 'string' && ['summary', 'text', 'links', 'forms', 'html'].includes(body.mode)) {
    uwafRequest.mode = body.mode as UwafBrowserRequest['mode']
  }
  uwafRequest.browserMode = requestBrowserMode
  if (typeof body.depth === 'number' && Number.isInteger(body.depth) && body.depth >= 1 && body.depth <= 3) {
    uwafRequest.depth = body.depth
  }
  if (typeof body.selector === 'string' && body.selector.trim()) uwafRequest.selector = body.selector.trim()
  if (typeof body.text === 'string') uwafRequest.text = body.text
  if (typeof body.key === 'string' && body.key.trim()) uwafRequest.key = body.key.trim()
  if (typeof body.tabIndex === 'number' && Number.isInteger(body.tabIndex) && body.tabIndex >= 0) uwafRequest.tabIndex = body.tabIndex
  if (typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs) && body.timeoutMs >= 0) uwafRequest.timeoutMs = body.timeoutMs
  if (typeof body.deltaY === 'number' && Number.isFinite(body.deltaY)) uwafRequest.deltaY = body.deltaY
  if (typeof body.optionValue === 'string' && body.optionValue.trim()) uwafRequest.optionValue = body.optionValue.trim()
  if (typeof body.optionLabel === 'string' && body.optionLabel.trim()) uwafRequest.optionLabel = body.optionLabel.trim()

  try {
    // If user has interrupted the browser, wait for them to resume (up to 2 minutes)
    const maxWaitMs = 120_000
    const checkIntervalMs = 1_000
    let waited = 0
    while (isBrowserInterrupted(userId, sessionId, requestBrowserMode) && waited < maxWaitMs) {
      await new Promise(r => setTimeout(r, checkIntervalMs))
      waited += checkIntervalMs
    }

    const result = await runUwafBrowserAction(userId, uwafRequest, {
      openClawUwafBrowserMode: settings.openClawUwafBrowserMode,
      openClawUwafScreenshots: normalizeBoolean(settings.openClawUwafScreenshots),
      openClawUwafDefaultMode: settings.openClawUwafDefaultMode,
    })

    if (
      result.action === 'open'
      || result.action === 'click'
      || result.action === 'fill'
      || result.action === 'submit'
      || result.action === 'research_batch'
      || result.action === 'new_tab'
      || result.action === 'switch_tab'
      || result.action === 'close_tab'
      || result.action === 'back'
      || result.action === 'forward'
    ) {
      await restartScreencastForSession(userId, sessionId, requestBrowserMode)
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('disabled') || message.includes('blocked') || message.includes('not allowed')) {
      return NextResponse.json({ error: message }, { status: 403 })
    }
    if (message.includes('unavailable') || message.includes('Tor proxy')) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
