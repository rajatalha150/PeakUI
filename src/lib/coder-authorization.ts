/**
 * Server-side authorization for the coder gateway.
 *
 * The coder daemon is a SINGLE shared process reached by every PeakUI user, so
 * the gateway cannot just forward anything the caller asks for. This module
 * owns the two boundaries the pass-through alone cannot express:
 *
 *  1. **Session ownership** — a daemon session is keyed by the persistent
 *     `ChatSession` UUID (`surface: 'coder'`), so a caller who knows or guesses
 *     that UUID must not be able to reattach to, read, mutate, cancel, or
 *     delete another user's session. Every `/session/:id/...` operation is
 *     checked against the authenticated user's ownership of `:id`.
 *
 *  2. **Privileged-route deny** — daemon-wide configuration (auth, MCP,
 *     extensions, usage/stats) is an administrative boundary. A normal coder
 *     user can drive sessions and their own workspace; they must not reach
 *     daemon-wide config merely because they can use the coder.
 *
 * Caller-provided ids, workspace paths, client headers, and model output are
 * never treated as proof of ownership — only the server's own DB association
 * (ChatSession.userId) is.
 */

import { prisma } from './prisma'

/**
 * Daemon prefixes that reconfigure the daemon itself rather than a specific
 * session/workspace. Non-admin users are denied these outright; the UI never
 * needs them (session model/approval and per-workspace settings are separate,
 * non-privileged routes).
 */
const PRIVILEGED_PREFIXES = ['/auth', '/mcp', '/extensions', '/usage', '/stats']

/** True when `path` addresses a daemon-wide privileged surface. */
export function isPrivilegedCoderPath(path: string): boolean {
  return PRIVILEGED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

/** True when `path` addresses a specific daemon session (`/session/:id/...`). */
export function isSessionPath(path: string): boolean {
  return /^\/session\/[^/]+/.test(path)
}

/**
 * Daemon routes that read/write workspace files by a caller-supplied path.
 * These are workspace-scoped (not session-scoped), so session ownership does
 * not cover them — they are authorized separately against a canonical path.
 */
const FILE_OPERATION_PATHS = new Set([
  '/file',
  '/file/bytes',
  '/list',
  '/stat',
  '/glob',
  '/file/write',
  '/file/edit',
])

/** True when `path` is a daemon file read/write route. */
export function isFileOperationPath(path: string): boolean {
  return FILE_OPERATION_PATHS.has(path)
}

/**
 * Extract the daemon session id from `/session/<id>` or `/session/<id>/…`.
 * Returns null when the path does not address a specific session (e.g. the bare
 * `/session` create route or the `/sessions` list route).
 */
export function extractCoderSessionId(path: string): string | null {
  const match = /^\/session\/([^/]+)/.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

/**
 * True when the authenticated user owns the given coder session. The session
 * id is the persistent `ChatSession` id (surface `'coder'`) that the daemon
 * session is keyed by — an unknown or foreign id is indistinguishable from a
 * missing session and is denied the same way (so existence is never leaked).
 */
export async function authorizeCoderSession(userId: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return false
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, surface: true },
  })
  return Boolean(session && session.userId === userId && session.surface === 'coder')
}

/**
 * Canonicalise a workspace/cwd path for daemon routing. Returns the normalized
 * absolute path, or `null` when the value cannot be a valid daemon workspace
 * (not absolute, path traversal, or a crafted encoding). The daemon itself is
 * the final authority on what a registered workspace can read/write, but
 * rejecting obvious traversal here stops a crafted `?workspace=` from walking
 * the gateway into a path shape that was never registered.
 */
export function normalizeCoderWorkspacePath(value: string): string | null {
  return canonicalAbsolutePath(value)
}

/**
 * Canonicalise a workspace *file* path for the daemon's file routes
 * (`/file`, `/list`, `/stat`, `/glob`, `/file/write`, `/file/edit`). Same rule
 * as the workspace path — absolute, no traversal, collapse duplicate slashes —
 * applied to the caller-supplied `path` param so a crafted relative or `..`
 * path cannot walk the gateway into a file the daemon never registered.
 */
export function normalizeCoderFilePath(value: string): string | null {
  return canonicalAbsolutePath(value)
}

/** Shared canonical-absolute-path validation (see the two exports above). */
function canonicalAbsolutePath(value: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('/')) return null

  const segments = trimmed.split('/')
  // A `..` segment (after decoding) is a traversal attempt, not a workspace.
  if (segments.includes('..')) return null

  const collapsed = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '')
  return collapsed || '/'
}
