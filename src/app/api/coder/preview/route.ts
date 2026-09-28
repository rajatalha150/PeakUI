/**
 * POST /api/coder/preview — server-side validation of a preview URL.
 *
 * The preview pane frames a loopback dev server the agent started. The client
 * already applies `parsePreviewUrl` before rendering an iframe, but the agent
 * writes the URL into `.peakui-preview.json` and the browser is not the only
 * boundary that should trust it: this route re-validates the value server-side
 * (defense in depth) so a URL that is not a safe loopback dev server is refused
 * at the API boundary too, not just in the UI.
 *
 * The browser receives a signed launch URL on the isolated Preview origin.
 * The private bridge hostname never reaches the browser, because its
 * `localhost` would resolve on a remote viewer's computer rather than on the
 * PeakUI host.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { isLocalPreviewHost, parsePreviewUrl } from '@/lib/coder-preview'
import { signPreviewTicket } from '@/lib/coder-preview-ticket'

function requestHostname(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  return (forwarded || req.headers.get('host') || req.nextUrl.host).replace(/:\d+$/, '')
}

export async function POST(req: NextRequest) {
  const auth = await requireCoderAccess(req)
  if ('response' in auth) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a `url`.', code: 'bad_request' }, { status: 400 })
  }

  const url = body && typeof body === 'object' && 'url' in body && typeof body.url === 'string' ? body.url : ''
  if (!url.trim()) {
    return NextResponse.json({ error: 'Preview URL is required.', code: 'bad_request' }, { status: 400 })
  }

  const parsed = parsePreviewUrl(url, { allowGuestPorts: process.env.CODER_BACKEND === 'lxd', allowRemote: true })
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error, code: 'invalid_preview_url' }, { status: 400 })
  }

  const original = new URL(url)
  if (!isLocalPreviewHost(original.hostname)) {
    return NextResponse.json({
      ok: true,
      target: parsed.target,
      previewUrl: original.toString(),
      captureUrl: original.toString(),
      remote: true,
    })
  }
  // Accept preview values saved by the prior `p<port>.localhost:4172` scheme
  // too, then immediately return the durable same-origin route. This makes an
  // existing open Preview window self-heal after the upgrade.
  const legacyHost = /^p(s?)(\d{1,5})\.localhost$/i.exec(original.hostname)
  const targetPort = legacyHost ? Number(legacyHost[2]) : parsed.target.port
  const secure = legacyHost ? legacyHost[1].toLowerCase() === 's' : original.protocol === 'https:'
  const ticket = signPreviewTicket({ port: targetPort, secure, userId: auth.userId })
  const gatewayPort = Number(process.env.CODER_PREVIEW_GATEWAY_PORT || 4173)
  const launch = `/__peakui/open?ticket=${encodeURIComponent(ticket)}&path=${encodeURIComponent(`${original.pathname}${original.search}${original.hash}`)}`
  const publicOrigin = process.env.CODER_PREVIEW_PUBLIC_ORIGIN?.replace(/\/$/, '')
    || `http://${requestHostname(req)}:${gatewayPort}`
  return NextResponse.json({
    ok: true,
    target: parsed.target,
    previewUrl: `${publicOrigin}${launch}`,
    captureUrl: `http://127.0.0.1:${gatewayPort}${launch}`,
  })
}
