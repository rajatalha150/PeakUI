/**
 * GET /api/workspace-tool/reliability
 * Returns the tool-reliability snapshot (per-model, per-tool success/failure).
 *
 * POST accepts either:
 *   { reset: true }                          — clear the in-memory store
 *   { model, tool, success, errorMessage }   — record a single outcome
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getToolReliability, resetToolReliability, recordToolOutcome } from '@/lib/tool-reliability'

export async function GET() {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before viewing tool reliability.',
  })
  if ('response' in access) return access.response

  return NextResponse.json({ records: getToolReliability() })
}

export async function POST(req: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before recording tool reliability.',
  })
  if ('response' in access) return access.response

  try {
    const body = await req.json().catch(() => ({})) as {
      reset?: boolean
      model?: string
      tool?: string
      success?: boolean
      errorMessage?: string
    }

    if (body.reset === true) {
      resetToolReliability()
      return NextResponse.json({ success: true, records: getToolReliability() })
    }

    if (typeof body.model === 'string' && typeof body.tool === 'string' && typeof body.success === 'boolean') {
      recordToolOutcome(body.model, body.tool, body.success, body.errorMessage)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid request: provide { reset: true } or { model, tool, success }.' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
