/**
 * POST /api/workspace-tool/http-request
 * Generic authenticated HTTP request tool (Phase 3). Lets the model call real
 * APIs (GET/POST/PUT/PATCH/DELETE) with headers and a JSON body, behind the
 * same SSRF guard as the web tool.
 *
 * Body:
 *   { method, url, headers?, body?, timeoutMs? }
 *
 * Security:
 *   - URL must pass assertPublicHttpUrl (no private/localhost/credentialed URLs).
 *   - Response body is capped; only text/JSON is returned (no binary).
 *   - A per-user rate limit bounds request volume.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { assertPublicHttpUrl, extractReadableText } from '@/lib/web-context'

const MAX_RESPONSE_BYTES = 200_000
const MAX_RESPONSE_CHARS = 100_000
const MAX_BODY_BYTES = 50_000
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

// Simple in-memory per-user rate limit (resets on restart; sufficient for a
// single-user self-hosted deployment).
const rateLimit = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

export async function POST(req: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before using the HTTP request tool.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  // Rate limit.
  const now = Date.now()
  const record = rateLimit.get(userId)
  if (record && now - record.windowStart < RATE_LIMIT_WINDOW_MS) {
    if (record.count >= RATE_LIMIT_MAX) {
      return NextResponse.json({ error: 'Rate limit exceeded. Wait a minute before more requests.' }, { status: 429 })
    }
    record.count += 1
  } else {
    rateLimit.set(userId, { count: 1, windowStart: now })
  }

  try {
    const body = await req.json() as {
      method?: string
      url?: string
      headers?: Record<string, string>
      body?: unknown
      timeoutMs?: number
      offset?: number
    }

    const method = (body.method || 'GET').toUpperCase()
    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json({ error: `Method ${method} not allowed. Use GET/POST/PUT/PATCH/DELETE.` }, { status: 400 })
    }

    const rawUrl = (body.url || '').trim()
    if (!rawUrl) {
      return NextResponse.json({ error: 'A URL is required.' }, { status: 400 })
    }

    let safeUrl: URL
    try {
      safeUrl = await assertPublicHttpUrl(rawUrl)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Blocked URL' }, { status: 400 })
    }

    // Sanitize headers: drop hop-by-hop and auth-injection risk is the caller's
    // explicit choice, but block Host/Content-Length (managed by fetch).
    const headers: Record<string, string> = {}
    if (body.headers && typeof body.headers === 'object') {
      for (const [key, value] of Object.entries(body.headers)) {
        const lower = key.toLowerCase()
        if (lower === 'host' || lower === 'content-length' || lower === 'connection') continue
        if (typeof value === 'string' && value.length <= 2000) headers[key] = value
      }
    }

    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1000, typeof body.timeoutMs === 'number' ? body.timeoutMs : DEFAULT_TIMEOUT_MS),
    )

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'User-Agent': 'PeakUI/1.0 (workspace-tool http_request)',
        'Accept': 'application/json, text/plain, */*',
        ...headers,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    }

    if (method !== 'GET' && method !== 'DELETE' && body.body !== undefined) {
      const serialized = typeof body.body === 'string' ? body.body : JSON.stringify(body.body)
      if (Buffer.byteLength(serialized, 'utf-8') > MAX_BODY_BYTES) {
        return NextResponse.json({ error: 'Request body too large.' }, { status: 413 })
      }
      fetchOptions.body = serialized
      if (!headers['content-type'] && !headers['Content-Type']) {
        fetchOptions.headers = { ...(fetchOptions.headers as Record<string, string>), 'Content-Type': 'application/json' }
      }
    }

    const response = await fetch(safeUrl, fetchOptions)

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const isText = contentType.includes('json') || contentType.includes('text') || contentType.includes('xml') || contentType.includes('javascript')

    // Extract: for HTML, convert to readable text BEFORE anything else. The
    // raw-HTML path was the root cause of the "keep going" fetch loops: page
    // chrome (<head>, CSS, <nav>) consumed the entire response budget before
    // the actual content (e.g. a Drupal accordion contractor directory), so
    // the model re-fetched the same URL forever and every retry truncated at
    // the same spot. Readability strips the chrome and keeps the content.
    let responseBody: string | null = null
    let totalChars: number | null = null
    let offset = 0
    let hasMore = false
    if (isText) {
      let text = await response.text()
      if (contentType.includes('html')) {
        try {
          const extracted = extractReadableText(text, safeUrl)
          const readable = [extracted?.title ? `# ${extracted.title}` : '',
            extracted?.description ? `> ${extracted.description}` : '',
            extracted?.text ?? ''].filter(Boolean).join('\n\n')
          if (readable.trim()) text = readable
        } catch {
          // Readability failed — fall back to the raw HTML slice below.
        }
      }
      totalChars = text.length
      offset = Math.max(0, Math.floor(typeof body.offset === 'number' && Number.isFinite(body.offset) ? body.offset : 0))
      responseBody = text.slice(offset, offset + MAX_RESPONSE_CHARS)
      hasMore = offset + responseBody.length < totalChars
    }

    return NextResponse.json({
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      contentType,
      headers: {
        'content-type': contentType,
      },
      body: responseBody,
      // Paging metadata so the model can continue a truncated response instead
      // of blind-refetching: nextOffset is the exact char position to pass as
      // `offset` on the next identical request.
      totalChars,
      offset,
      nextOffset: hasMore ? offset + (responseBody?.length ?? 0) : null,
      truncated: hasMore,
      finalUrl: response.url || safeUrl.href,
    })
  } catch (error) {
    console.error('[http-request] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'HTTP request failed' }, { status: 502 })
  }
}