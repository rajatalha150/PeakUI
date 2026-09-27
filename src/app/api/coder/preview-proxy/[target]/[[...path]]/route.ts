import { NextResponse, type NextRequest } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { parseLxdPreviewProxyTarget } from '@/lib/coder-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOP_BY_HOP = new Set([
  'connection', 'content-length', 'host', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])

function previewPrefix(target: string) {
  return `/api/coder/preview-proxy/${target}`
}

function proxyHeaders(source: Headers, host: string) {
  const headers = new Headers()
  source.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== 'cookie') headers.set(key, value)
  })
  headers.set('host', host)
  headers.set('x-forwarded-host', host)
  return headers
}

function responseHeaders(source: Headers) {
  const headers = new Headers()
  source.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!HOP_BY_HOP.has(lower) && lower !== 'content-security-policy' && lower !== 'content-encoding') headers.set(key, value)
  })
  return headers
}

function rewriteHtml(html: string, prefix: string) {
  // Apps commonly emit absolute asset/API paths. Make those travel through the
  // same authenticated route too, instead of accidentally targeting PeakUI.
  const rewritten = html
    .replace(/\b(src|href|action)=(['"])\/(?!\/)/gi, `$1=$2${prefix}/`)
    .replace(/\b(srcset)=(['"])([^'"]*)/gi, (_match, attribute, quote, value) => `${attribute}=${quote}${value.replace(/(^|\s)\/(?!\/)/g, `$1${prefix}/`)}`)
  const base = `<base href="${prefix}/">`
  return /<head(?:\s[^>]*)?>/i.test(rewritten)
    ? rewritten.replace(/<head(\s[^>]*)?>/i, match => `${match}${base}`)
    : `${base}${rewritten}`
}

function rewriteJavaScript(source: string, prefix: string) {
  // Vite emits root-relative strings for API requests and lazily imported
  // chunks. Without this, HTML renders but the client bundle talks to PeakUI's
  // own `/api` routes (or loads chunks from PeakUI) and the preview becomes a
  // misleading blank white page.
  return source.replace(
    /(['"])\/(api|assets)(?=\/|['"])/g,
    `$1${prefix}/$2`,
  )
}

function rewriteLocation(location: string, prefix: string) {
  if (location.startsWith('/')) return `${prefix}${location}`
  return location
}

async function handle(req: NextRequest, context: { params: Promise<{ target: string; path?: string[] }> }) {
  const auth = await requireCoderAccess(req)
  if ('response' in auth) return auth.response

  const { target, path = [] } = await context.params
  const parsed = parseLxdPreviewProxyTarget(target)
  if (!parsed) return NextResponse.json({ error: 'Invalid preview target.' }, { status: 400 })

  const suffix = `/${path.map(segment => encodeURIComponent(segment)).join('/')}`.replace(/\/$/, '/')
  const protocol = parsed.secure ? 'https' : 'http'
  const bridgeHost = `p${parsed.secure ? 's' : ''}${parsed.port}.localhost:4172`
  const upstreamUrl = `${protocol}://${bridgeHost}${suffix}${req.nextUrl.search}`
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: proxyHeaders(req.headers, bridgeHost),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      // Required by undici when passing an incoming ReadableStream request body.
      duplex: 'half',
      redirect: 'manual',
      cache: 'no-store',
    } as RequestInit)
  } catch {
    return NextResponse.json({ error: 'Preview server is not reachable.' }, { status: 502 })
  }

  const headers = responseHeaders(upstream.headers)
  const prefix = previewPrefix(target)
  const location = upstream.headers.get('location')
  if (location) headers.set('location', rewriteLocation(location, prefix))
  const contentType = upstream.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    const html = rewriteHtml(await upstream.text(), prefix)
    headers.set('content-type', contentType)
    headers.delete('content-length')
    return new NextResponse(html, { status: upstream.status, headers })
  }
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
    const script = rewriteJavaScript(await upstream.text(), prefix)
    headers.set('content-type', contentType)
    headers.delete('content-length')
    return new NextResponse(script, { status: upstream.status, headers })
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const HEAD = handle
