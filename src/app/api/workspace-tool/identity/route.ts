import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { deleteIdentity } from '@/lib/uwaf-identity'
import type { BrowserMode } from '@/lib/uwaf-pool'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface IdentityDeleteRequestBody {
  sessionId?: string
  mode?: BrowserMode
}

/**
 * Rotate / clear the persisted direct-mode identity for the current user.
 * After deletion the next browser session regenerates a fresh fingerprint
 * seed and starts with no cookies.
 */
export async function DELETE(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'workspace-tool.uwaf'], {
    forbiddenMessage: 'Identity management requires WorkSpaces + UWAF permissions.',
  })
  if ('response' in access) return access.response

  let body: IdentityDeleteRequestBody = {}
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : 'default'
  const mode: BrowserMode = body.mode === 'stealth' ? 'stealth' : 'direct'

  try {
    await deleteIdentity(access.userId, sessionId, mode)
    return NextResponse.json({ success: true, sessionId, mode })
  } catch (error) {
    console.error('[workspace-tool/identity] DELETE error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete identity' },
      { status: 500 }
    )
  }
}
