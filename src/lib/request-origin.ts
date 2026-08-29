/**
 * Resolve the public origin of a request, honoring reverse-proxy headers.
 *
 * When PeakUI sits behind a reverse proxy (nginx, Caddy, etc.), the request's
 * own `nextUrl.origin` is the internal address (e.g. http://localhost:3000),
 * not the address the browser used. The proxy forwards the real host/proto in
 * `x-forwarded-host` / `x-forwarded-proto`, so we prefer those when present.
 *
 * This is used to build absolute URLs (e.g. Canvas artifact download links)
 * that the model can copy verbatim and the browser can actually reach.
 */
export function resolvePublicOrigin(req: Request): string {
  const headers = req.headers
  const forwardedHost = headers.get('x-forwarded-host')
  const forwardedProto = headers.get('x-forwarded-proto')

  if (forwardedHost) {
    const host = forwardedHost.split(',')[0].trim()
    const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : 'https'
    return `${proto}://${host}`
  }

  // No proxy headers — fall back to the request's own origin.
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}
