/**
 * /api/coder/* — authenticated pass-through to the Qwen Code daemon.
 *
 * This is the only browser-facing path to the coding brain. It requires
 * WorkSpaces access (same permission as the rest of the agent surface), then
 * forwards the request to the daemon with the bearer token attached
 * server-side — the browser never sees the token.
 *
 * Design note: this is a PASS-THROUGH, not a hand-maintained route whitelist.
 * The daemon exposes a large, versioned surface (session lifecycle, model /
 * approval-mode / permission control, files, workspaces, skills, MCP, stats,
 * LSP, …) and enumerating it here just guarantees drift: the previous
 * whitelist silently 404'd `GET /session/:id/status` (which the UI polls),
 * `POST /session/:id/cancel`, `POST /session/:id/approval-mode` and
 * `POST /session/:id/permission/:id` — so live status never updated, runs
 * could not be stopped, and any tool needing approval stalled forever.
 *
 * Two explicit exceptions are handled locally:
 *   - GET  /api/coder/session/:id/events  → relayed as a raw SSE stream so
 *     agent output drips in live instead of arriving in one buffered blob.
 *   - Any path not under the daemon's own API prefixes is rejected, so a
 *     crafted path cannot walk the gateway into an unrelated upstream route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import {
  forwardableRequestHeaders,
  proxyToCoderDaemon,
  streamCoderSse,
} from '@/lib/coder-gateway'

const REQUIRED: PermissionKey[] = ['workspace-tool.use']

/**
 * Daemon API roots we allow through. Everything the daemon serves lives under
 * one of these; anything else is a bug or an attack, and is refused rather
 * than forwarded.
 */
const ALLOWED_PREFIXES = [
  '/health',
  '/capabilities',
  '/daemon-status',
  '/session',
  '/sessions',
  '/permission',
  '/workspace',
  '/workspaces',
  '/file',
  '/list',
  '/glob',
  '/stat',
  '/usage',
  '/language',
  '/extensions',
  '/auth',
  '/models',
  '/mcp',
]

/** Daemon-served paths that carry binary/stream bodies rather than JSON. */
const STREAMING_SUFFIX = /^\/session\/[^/]+\/events$/

async function auth() {
  return requireCurrentAuthWithPermissions(REQUIRED, {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired:
      'Grant the WorkSpaces permission in Settings -> User Management before using the Coding environment.',
  })
}

/** Map `/api/coder/<rest>` (plus query) onto the daemon's own URL shape. */
function toDaemonPath(req: NextRequest): { path: string; query: string } | null {
  const { pathname, search, searchParams } = req.nextUrl

  // The daemon addresses sessions by workspace as `/workspaces/<cwd>/sessions`.
  // The UI prefers `?workspace=<cwd>`; translate it so both spellings work.
  if (pathname === '/api/coder/sessions') {
    const workspace = searchParams.get('workspace')
    if (!workspace) return null
    return { path: `/workspaces/${encodeURIComponent(workspace)}/sessions`, query: '' }
  }

  const rest = pathname.replace(/^\/api\/coder/, '')
  if (!rest) return null
  if (!ALLOWED_PREFIXES.some(prefix => rest === prefix || rest.startsWith(`${prefix}/`))) {
    return null
  }
  return { path: rest, query: search }
}

function notFound(message = 'Unknown coding route') {
  return NextResponse.json({ error: message, code: 'not_found' }, { status: 404 })
}

function relay(result: Awaited<ReturnType<typeof proxyToCoderDaemon>>) {
  // A 204/205/304 MUST NOT carry a body: the Response constructor throws on a
  // non-null body for those statuses, which turned the daemon's 204 from
  // `POST /session/:id/cancel` into a 500. The gateway reads the daemon body as
  // text, so an empty 204 arrives as '' — pass null instead.
  const nullBodyStatus = result.status === 204 || result.status === 205 || result.status === 304
  return new NextResponse(nullBodyStatus ? null : result.body, {
    // A daemon 4xx/5xx is a real answer for the UI to read (e.g. 404 stale
    // session, 403 untrusted workspace), so pass the status through verbatim.
    status: result.status,
    headers: {
      'Content-Type': result.contentType || 'application/json',
      ...result.headers,
    },
  })
}

export async function GET(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  // Live event stream: hand back an unframed SSE relay, cancel upstream when
  // the browser goes away.
  if (STREAMING_SUFFIX.test(target.path)) {
    return streamCoderSse(`${target.path}${target.query}`, {
      method: 'GET',
      headers: forwardableRequestHeaders(req.headers),
      signal: req.signal,
    })
  }

  return relay(
    await proxyToCoderDaemon(`${target.path}${target.query}`, {
      method: 'GET',
      headers: forwardableRequestHeaders(req.headers),
    }),
  )
}

export async function POST(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const body = await req.json().catch(() => undefined)

  // A prompt can legitimately run for minutes on a local model; stream it when
  // the caller asked for SSE, otherwise allow a long JSON timeout.
  const wantsStream = req.headers.get('accept')?.includes('text/event-stream') === true
  if (wantsStream) {
    return streamCoderSse(`${target.path}${target.query}`, {
      method: 'POST',
      body,
      headers: forwardableRequestHeaders(req.headers),
      signal: req.signal,
    })
  }

  return relay(
    await proxyToCoderDaemon(`${target.path}${target.query}`, {
      method: 'POST',
      ...(body !== undefined ? { body } : {}),
      headers: forwardableRequestHeaders(req.headers),
      timeoutMs: 5 * 60_000,
    }),
  )
}

export async function PATCH(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const body = await req.json().catch(() => undefined)
  return relay(
    await proxyToCoderDaemon(`${target.path}${target.query}`, {
      method: 'PATCH',
      ...(body !== undefined ? { body } : {}),
      headers: forwardableRequestHeaders(req.headers),
    }),
  )
}

export async function DELETE(req: NextRequest) {
  const access = await auth()
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const body = await req.json().catch(() => undefined)
  return relay(
    await proxyToCoderDaemon(`${target.path}${target.query}`, {
      method: 'DELETE',
      ...(body !== undefined ? { body } : {}),
      headers: forwardableRequestHeaders(req.headers),
    }),
  )
}
