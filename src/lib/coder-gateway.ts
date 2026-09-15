/**
 * Server-side gateway to the Qwen Code daemon (the Coding environment's brain).
 *
 * The `coder` container runs `qwen serve` on loopback (host networking). This
 * module is the only path from the browser to the daemon: it resolves the daemon
 * URL + bearer token server-side (the browser never sees the token), forwards
 * requests, and can relay the daemon's SSE stream.
 *
 * Daemon reachability:
 *   - App uses host networking, so the daemon is at 127.0.0.1:4170 by default.
 *   - Override with CODER_DAEMON_URL (e.g. a remote/multi-host daemon).
 *   - CODER_SERVER_TOKEN, if set, is attached as `Authorization: Bearer <tok>`
 *     on every forwarded request.
 */

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4170'

export function getCoderDaemonBaseUrl(): string {
  const raw = (process.env.CODER_DAEMON_URL || DEFAULT_DAEMON_URL).trim()
  return raw.replace(/\/+$/, '')
}

export function getCoderDaemonToken(): string {
  return (process.env.CODER_SERVER_TOKEN || '').trim()
}

export interface CoderProxyResult {
  ok: boolean
  status: number
  headers: Record<string, string>
  /** Raw response body text (empty for streams we relay separately). */
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
  } = {},
): Promise<CoderProxyResult> {
  const base = getCoderDaemonBaseUrl()
  const token = getCoderDaemonToken()
  const method = options.method || 'GET'
  const target = `${base}${daemonPath}`

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    }

    const init: RequestInit = {
      method,
      headers,
      // The daemon streams over SSE; we forward the body through.
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(60_000),
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
 * Relay a prompt to the daemon and stream the response back as SSE. Used by the
 * chat surface so the agent's answer drips in live. Returns a streaming Response.
 */
export async function streamCoderPrompt(
  daemonPath: string,
  body: unknown,
): Promise<Response> {
  const base = getCoderDaemonBaseUrl()
  const token = getCoderDaemonToken()
  const target = `${base}${daemonPath}`

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60_000),
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
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
