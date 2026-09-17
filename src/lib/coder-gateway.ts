/**
 * Server-side gateway to the Qwen Code daemon (the Coding environment's brain).
 *
 * The `coder` container runs `qwen serve` on loopback (host networking). This
 * module is the only path from the browser to the daemon: it resolves the daemon
 * URL + bearer token server-side (the browser never sees the token), forwards
 * requests, and relays the daemon's SSE stream.
 *
 * Daemon reachability:
 *   - App uses host networking, so the daemon is at 127.0.0.1:4170 by default.
 *   - Override with CODER_DAEMON_URL (e.g. a remote/multi-host daemon).
 *   - CODER_SERVER_TOKEN, if set, is attached as `Authorization: Bearer <token>`
 *     on every forwarded request.
 */

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4170'

/**
 * Timeout for ordinary JSON round-trips. A prompt turn can legitimately take
 * minutes on a local model, so those go through `streamCoderSse` (which has no
 * overall deadline, only an idle guard) instead of this.
 */
const JSON_TIMEOUT_MS = 60_000

export function getCoderDaemonBaseUrl(): string {
  // A whitespace-only override must fall back, not resolve to an empty base —
  // otherwise every forwarded URL becomes a relative path and every request
  // fails in a way that looks like the daemon is down.
  const raw = (process.env.CODER_DAEMON_URL || '').trim() || DEFAULT_DAEMON_URL
  return raw.replace(/\/+$/, '')
}

export function getCoderDaemonToken(): string {
  return (process.env.CODER_SERVER_TOKEN || '').trim()
}

export interface CoderProxyResult {
  ok: boolean
  status: number
  headers: Record<string, string>
  /** Raw response body text (empty for streams relayed separately). */
  body: string
  contentType: string
}

const PASS_THROUGH_RESPONSE_HEADERS = [
  'content-type',
  'x-qwen-event-epoch',
  'x-qwen-sse-stream-id',
  'retry-after',
  'x-qwen-client-id',
]

function buildHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  }
}

/** Forward an inbound header set the daemon understands (client identity). */
export function forwardableRequestHeaders(inbound: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  // The daemon uses `x-qwen-client-id` for cross-client UI updates (and for
  // attributing permission votes). Forward it so a browser tab keeps a stable
  // identity across the gateway hop.
  const clientId = inbound.get('x-qwen-client-id')
  if (clientId) out['x-qwen-client-id'] = clientId
  return out
}

/**
 * Forward an inbound request to the daemon and return the raw response for the
 * route to relay. Adds the bearer token server-side. Never throws on a daemon
 * outage — returns a typed result the route can surface as a 502.
 */
export async function proxyToCoderDaemon(
  daemonPath: string,
  options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<CoderProxyResult> {
  const base = getCoderDaemonBaseUrl()
  const token = getCoderDaemonToken()
  const method = options.method || 'GET'
  const target = `${base}${daemonPath}`

  try {
    const init: RequestInit = {
      method,
      headers: buildHeaders(token, options.headers),
      // The daemon streams over SSE; we forward the body through.
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? JSON_TIMEOUT_MS),
    }

    const res = await fetch(target, init)

    const body = await res.text()
    const passthrough: Record<string, string> = {}
    for (const name of PASS_THROUGH_RESPONSE_HEADERS) {
      const value = res.headers.get(name)
      if (value) passthrough[name] = value
    }

    return {
      ok: res.ok,
      status: res.status,
      headers: passthrough,
      body,
      contentType: res.headers.get('content-type') || '',
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      headers: {},
      body: JSON.stringify({
        error: 'Coding environment is unreachable.',
        code: 'coder_daemon_unreachable',
        detail: error instanceof Error ? error.message : String(error),
      }),
      contentType: 'application/json',
    }
  }
}

/**
 * Relay a streaming daemon endpoint back to the browser as SSE.
 *
 * Used for `GET /session/:id/events` (the live agent event stream). Unlike
 * `proxyToCoderDaemon`, this hands back the upstream `ReadableStream` untouched
 * so frames arrive as the agent produces them — no buffering, no 60s ceiling.
 * A `signal` from the route cancels the upstream fetch when the browser
 * disconnects, so an abandoned tab cannot pin a daemon subscription.
 */
export async function streamCoderSse(
  daemonPath: string,
  options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal
  } = {},
): Promise<Response> {
  const base = getCoderDaemonBaseUrl()
  const token = getCoderDaemonToken()
  const method = options.method || 'GET'
  const target = `${base}${daemonPath}`

  try {
    const upstream = await fetch(target, {
      method,
      headers: buildHeaders(token, { Accept: 'text/event-stream', ...(options.headers || {}) }),
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal,
    })

    const passthrough: Record<string, string> = {}
    for (const name of PASS_THROUGH_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) passthrough[name] = value
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      return new Response(
        text || JSON.stringify({ error: 'Coding event stream unavailable.' }),
        {
          status: upstream.status,
          headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
        },
      )
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Defeat proxy buffering so frames flush immediately.
        'X-Accel-Buffering': 'no',
        ...passthrough,
      },
    })
  } catch (error) {
    // A client-initiated abort is normal (tab closed); don't dress it as 502.
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 })
    }
    return new Response(
      JSON.stringify({
        error: 'Coding environment is unreachable.',
        code: 'coder_daemon_unreachable',
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
