/**
 * /api/coder/* — thin proxy to the Qwen Code daemon (Coding environment).
 *
 * These routes gate the browser's access to the coding brain: they require
 * Workspace access (same permission as the rest of the agent surface), then
 * forward to the coder daemon with the bearer token attached server-side.
 *
 * Endpoints (all JSON, session-scoped):
 *   GET  /api/coder/health
 *   GET  /api/coder/capabilities
 *   POST /api/coder/session                 { cwd }
 *   GET  /api/coder/sessions?workspace=...   list sessions
 *   POST /api/coder/session/[id]/prompt      { prompt: [{type:"text",text}] }
 *   GET  /api/coder/session/[id]/transcript
 *   DELETE /api/coder/session/[id]
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import { proxyToCoderDaemon } from '@/lib/coder-gateway'

const REQUIRED: PermissionKey[] = ['workspace-tool.use']

async function auth() {
  return requireCurrentAuthWithPermissions(REQUIRED, {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before using the Coding environment.',
  })
}

/** Encode a workspace path so it can appear as a single path segment in the
 *  daemon's /workspaces/<cwd>/sessions route. */
function encodeWorkspaceSegment(workspace: string): string {
  return encodeURIComponent(workspace)
}

export async function GET(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const { pathname, searchParams } = req.nextUrl
  const suffix = pathname.replace(/^\/api\/coder/, '')
  const workspace = searchParams.get('workspace')

  // health + capabilities
  if (suffix === '/health' || suffix === '/capabilities') {
    return relay(suffix)
  }

  // list sessions: /api/coder/sessions?workspace=<cwd>
  if (suffix === '/sessions' && workspace) {
    return relay(`/workspaces/${encodeWorkspaceSegment(workspace)}/sessions`)
  }

  // transcript: /api/coder/session/<id>/transcript
  const transcriptMatch = suffix.match(/^\/session\/([^/]+)\/transcript$/)
  if (transcriptMatch) {
    return relay(`/session/${transcriptMatch[1]}/transcript`)
  }

  return NextResponse.json({ error: 'Unknown coding route', code: 'not_found' }, { status: 404 })
}

export async function POST(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const { pathname } = req.nextUrl
  const suffix = pathname.replace(/^\/api\/coder/, '')
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  // create session
  if (suffix === '/session') {
    return relay('/session', body)
  }

  // prompt: /api/coder/session/<id>/prompt
  const promptMatch = suffix.match(/^\/session\/([^/]+)\/prompt$/)
  if (promptMatch) {
    return relay(`/session/${promptMatch[1]}/prompt`, body)
  }

  return NextResponse.json({ error: 'Unknown coding route', code: 'not_found' }, { status: 404 })
}

export async function DELETE(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const { pathname } = req.nextUrl
  const suffix = pathname.replace(/^\/api\/coder/, '')
  const deleteMatch = suffix.match(/^\/session\/([^/]+)$/)
  if (deleteMatch) {
    return relay(`/session/${deleteMatch[1]}`, undefined, 'DELETE')
  }

  return NextResponse.json({ error: 'Unknown coding route', code: 'not_found' }, { status: 404 })
}

async function relay(daemonPath: string, body?: unknown, method = body !== undefined ? 'POST' : 'GET') {
  const result = await proxyToCoderDaemon(daemonPath, {
    method,
    ...(body !== undefined ? { body } : {}),
  })

  return new NextResponse(result.body, {
    status: result.ok ? result.status : 502,
    headers: {
      'Content-Type': result.contentType || 'application/json',
      ...result.headers,
    },
  })
}
