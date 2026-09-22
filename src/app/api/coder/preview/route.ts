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
 * This is a *guard*, not a proxy: the browser still fetches the preview target
 * directly. A full authenticated proxy (which would also close the "anyone on
 * loopback can view the dev server" gap) is a separate, larger piece of work —
 * it must rewrite relative URLs and forward HMR/websockets, which is why it is
 * not shipped here.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { parsePreviewUrl } from '@/lib/coder-preview'

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

  const parsed = parsePreviewUrl(url)
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error, code: 'invalid_preview_url' }, { status: 400 })
  }

  return NextResponse.json({ ok: true, target: parsed.target })
}
