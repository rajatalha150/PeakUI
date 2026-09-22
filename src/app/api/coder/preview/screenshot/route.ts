import { NextResponse, type NextRequest } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { capturePreviewScreenshot, PreviewCaptureError } from '@/lib/coder-preview-capture'
import type { PreviewDevice } from '@/lib/coder-preview'

const DEVICES = new Set<PreviewDevice>(['desktop', 'tablet', 'mobile'])

export async function POST(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response

  const body = await req.json().catch(() => null) as { url?: unknown; device?: unknown } | null
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const device = typeof body?.device === 'string' && DEVICES.has(body.device as PreviewDevice)
    ? body.device as PreviewDevice
    : null
  if (!url || !device) {
    return NextResponse.json({ error: 'A preview URL and device are required.', code: 'bad_request' }, { status: 400 })
  }

  try {
    return NextResponse.json(await capturePreviewScreenshot({ url, device }))
  } catch (error) {
    const code = error instanceof PreviewCaptureError ? error.code : 'preview_unreachable'
    const status = code === 'invalid_preview_url' ? 400 : code === 'preview_busy' ? 429 : code === 'preview_too_large' ? 413 : 502
    const messages: Record<typeof code, string> = {
      invalid_preview_url: 'Preview URL is not an approved local dev-server URL.',
      preview_busy: 'Preview capture is busy. Try again shortly.',
      preview_unreachable: 'The local preview could not be loaded for capture.',
      preview_too_large: 'The preview screenshot is too large to send to the vision model.',
    }
    return NextResponse.json({ error: messages[code], code }, { status })
  }
}
