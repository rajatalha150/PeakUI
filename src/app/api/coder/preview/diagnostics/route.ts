import { NextResponse, type NextRequest } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { collectPreviewDiagnostics, PreviewCaptureError } from '@/lib/coder-preview-capture'
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
  if (!url || !device) return NextResponse.json({ error: 'A preview URL and device are required.' }, { status: 400 })

  try {
    return NextResponse.json(await collectPreviewDiagnostics({ url, device }))
  } catch (error) {
    const code = error instanceof PreviewCaptureError ? error.code : 'preview_unreachable'
    const status = code === 'invalid_preview_url' ? 400 : code === 'preview_busy' ? 429 : 502
    return NextResponse.json({ error: 'Preview diagnostics could not be collected.', code }, { status })
  }
}
