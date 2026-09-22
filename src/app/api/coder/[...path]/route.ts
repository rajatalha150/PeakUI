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
import { requireCoderAccess } from '@/lib/coder-access'
import {
  authorizeCoderSession,
  bindCoderSessionWorkspace,
  extractCoderSessionId,
  isFileOperationPath,
  isPrivilegedCoderPath,
  normalizeCoderFilePath,
  normalizeCoderWorkspacePath,
} from '@/lib/coder-authorization'
import {
  forwardableRequestHeaders,
  proxyToCoderDaemon,
  streamCoderSse,
} from '@/lib/coder-gateway'

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

/** Map `/api/coder/<rest>` (plus query) onto the daemon's own URL shape. */
function toDaemonPath(req: NextRequest): { path: string; query: string } | null {
  const { pathname, search, searchParams } = req.nextUrl

  // The daemon addresses sessions by workspace as `/workspaces/<cwd>/sessions`.
  // The UI prefers `?workspace=<cwd>`; translate it so both spellings work.
  // Canonicalise the workspace before encoding so a crafted `?workspace=` cannot
  // walk the gateway into a relative or `..` path shape the daemon never registered.
  if (pathname === '/api/coder/sessions') {
    const workspace = searchParams.get('workspace')
    if (!workspace) return null
    const canonical = normalizeCoderWorkspacePath(workspace)
    if (!canonical) return null
    return { path: `/workspaces/${encodeURIComponent(canonical)}/sessions`, query: '' }
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

/**
 * Enforce the coder authorization boundary for a resolved target before it is
 * forwarded. Returns a denial response, or `null` to proceed.
 *
 * The daemon is a single shared process, so "the caller can use the coder" is
 * not enough: a specific session must be owned by the caller, and daemon-wide
 * configuration is reserved for administrators.
 */
async function authorizeCoderRequest(
  userId: string,
  role: string,
  target: { path: string; query?: string },
  body?: unknown,
): Promise<NextResponse | null> {
  // Daemon-wide config (auth/MCP/extensions/usage) is an admin boundary.
  if (isPrivilegedCoderPath(target.path) && role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'This coding route requires administrator access.', code: 'admin_required' },
      { status: 403 },
    )
  }

  // A specific daemon session must be owned by the caller. 404 (not 403) so a
  // foreign or missing session id is not distinguishable from a missing one.
  const sessionId = extractCoderSessionId(target.path)
  if (target.path.startsWith('/session/') && !sessionId) return notFound()
  if (sessionId) {
    const owned = await authorizeCoderSession(userId, sessionId)
    if (!owned) return notFound('Session not found')
  }

  // Workspace file routes are keyed by a caller-supplied `path`. They are not
  // session-scoped, so the ownership check above does not cover them; reject a
  // relative/traversal path before forwarding. The daemon's own workspace
  // containment is still the final authority — this is defense in depth so a
  // crafted `?path=../../…` never even reaches it.
  if (isFileOperationPath(target.path) && target.path !== '/glob') {
    const filePath = extractFilePath(target, body)
    if (filePath === undefined || normalizeCoderFilePath(filePath) === null) {
      return NextResponse.json(
        { error: 'File path must be an absolute, non-traversal path.', code: 'invalid_file_path' },
        { status: 400 },
      )
    }
  }

  // `POST /session` creates a daemon session keyed by the caller-supplied id in
  // the body; that id must be a ChatSession the caller owns.
  if (target.path === '/session' || /^\/session\/[^/]+\/load$/.test(target.path)) {
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    const id = sessionId || input.sessionId
    if (typeof id !== 'string' || !id || typeof input.cwd !== 'string' || !normalizeCoderWorkspacePath(input.cwd)) {
      return NextResponse.json({ error: 'A session ID and absolute workspace are required.', code: 'invalid_session' }, { status: 400 })
    }
    if (!await authorizeCoderSession(userId, id)) return notFound('Session not found')
    if (!await bindCoderSessionWorkspace(userId, id, input.cwd)) {
      return NextResponse.json({ error: 'This session belongs to a different workspace. Create a new session to change projects.', code: 'workspace_binding_conflict' }, { status: 409 })
    }
  }

  return null
}

/**
 * Pull the `path` a file route is operating on: from the query string for the
 * read routes (`/file`, `/list`, `/stat`, `/glob`) and from the body for the
 * write routes (`/file/write`, `/file/edit`). Returns undefined when absent so
 * the caller can reject the request rather than forwarding a pathless file op.
 */
function extractFilePath(
  target: { path: string; query?: string },
  body?: unknown,
): string | undefined {
  if (target.path === '/file/write' || target.path === '/file/edit') {
    if (body && typeof body === 'object' && 'path' in body) {
      const p = (body as { path?: unknown }).path
      return typeof p === 'string' ? p : undefined
    }
    return undefined
  }
  if (!target.query) return undefined
  const searchParams = new URLSearchParams(target.query)
  return searchParams.get('path') ?? undefined
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
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const denied = await authorizeCoderRequest(access.userId, access.auth.user.role, target)
  if (denied) return denied

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
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const body = await req.json().catch(() => undefined)

  const denied = await authorizeCoderRequest(access.userId, access.auth.user.role, target, body)
  if (denied) return denied

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
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const body = await req.json().catch(() => undefined)

  const denied = await authorizeCoderRequest(access.userId, access.auth.user.role, target, body)
  if (denied) return denied

  return relay(
    await proxyToCoderDaemon(`${target.path}${target.query}`, {
      method: 'PATCH',
      ...(body !== undefined ? { body } : {}),
      headers: forwardableRequestHeaders(req.headers),
    }),
  )
}

export async function DELETE(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response

  const target = toDaemonPath(req)
  if (!target) return notFound()

  const body = await req.json().catch(() => undefined)

  const denied = await authorizeCoderRequest(access.userId, access.auth.user.role, target, body)
  if (denied) return denied

  return relay(
    await proxyToCoderDaemon(`${target.path}${target.query}`, {
      method: 'DELETE',
      ...(body !== undefined ? { body } : {}),
      headers: forwardableRequestHeaders(req.headers),
    }),
  )
}
