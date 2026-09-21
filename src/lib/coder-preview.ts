/**
 * Preview-target validation for the Coding surface.
 *
 * The agent starts a dev server inside the coder container (which shares the
 * host network stack) and the preview pane shows it. A crafted
 * `.peakui-preview.json` could otherwise point the iframe at PeakUI itself, the
 * DB, SearXNG, the daemon, or the executor — and, because the iframe sandbox
 * permits `allow-same-origin`, a URL on the app's own origin would let the
 * previewed page reach the parent's cookies/localStorage.
 *
 * This module owns the *pure* validation of what counts as a safe loopback dev
 * server. The UI applies it before any URL is rendered, so the agent cannot
 * steer the preview at an internal service.
 */

/** Hostnames a preview target may bind to (the daemon binds loopback). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Ports already owned by other services on the host's loopback. The daemon runs
 * with host networking, so the agent's dev server CANNOT actually bind these
 * (they're taken) — allowing them through would just show the service the port
 * belongs to: the app on 3000, screencast on 3001, the daemon on 4170, the
 * executor on 4318, the DB on 5432, SearXNG on 8080, tor on 9050/9150.
 */
export const PREVIEW_RESERVED_PORTS = new Set<number>([
  3000, 3001, 4170, 4318, 5432, 8080, 9050, 9150,
])

export interface PreviewTarget {
  host: string
  port: number
  /** Path component of the target URL, always leading with `/`. */
  path: string
}

/**
 * Parse a user/agent-provided preview URL into a validated loopback target, or
 * an `error` string describing why it is not a safe local dev-server URL.
 */
export function parsePreviewUrl(raw: string): { target: PreviewTarget } | { error: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { error: 'Preview URL is not a valid URL.' }
  }

  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Preview URL must be http(s).' }
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    return { error: 'Preview URL must be a local dev server (127.0.0.1/localhost).' }
  }
  if (url.port === '') {
    return { error: 'Preview URL must include a port.' }
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { error: 'Preview port must be 1024–65535.' }
  }
  if (PREVIEW_RESERVED_PORTS.has(port)) {
    return { error: `Port ${port} is reserved for another service.` }
  }

  const path = url.pathname || '/'
  return { target: { host, port, path } }
}
