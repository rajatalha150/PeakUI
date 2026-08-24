import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { fetchAsReadableText } from '@/lib/web-fetch-strategy'

export const runtime = 'nodejs'
export const maxDuration = 60

// Inner fetch budget. The Next.js `maxDuration` above is 60s and is the
// hard wall-clock cap; this is a tighter per-call budget that lets us
// surface a useful error message instead of a generic 504 when the
// Playwright context wedges. 45s = 60s outer - 15s headroom for routing,
// auth, JSON serialization, etc.
const FETCH_TOOL_TIMEOUT_MS = 45_000

function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length >= 20 && s.length <= 300)
    .slice(0, 8)
}

function pickQuote(sentences: string[]): string | undefined {
  const candidates = sentences.filter(s => s.length >= 60 && s.length <= 240)
  return candidates.length > 0 ? candidates[0] : undefined
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'Fetch and summarize requires WorkSpaces permission.',
  })
  if ('response' in access) return access.response

  let url = ''
  try {
    const body = await request.json().catch(() => ({}))
    url = typeof body?.url === 'string' && body.url.trim() ? body.url.trim() : ''
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    const source = await fetchAsReadableText(url, {
      // Combine the request's natural abort signal with our tighter inner
      // budget. Either one aborting will cancel the fetch.
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(FETCH_TOOL_TIMEOUT_MS),
      ]),
      userId: access.auth.user.id,
    })
    if (!source) {
      return NextResponse.json(
        { success: false, url, error: 'Could not fetch or extract the page.' },
        { status: 502 },
      )
    }

    const text = source.excerpt || source.content || ''
    const sentences = splitSentences(text)
    const summary = sentences.slice(0, 5)
    const quote = pickQuote(sentences)

    return NextResponse.json({
      success: true,
      url: source.url || url,
      title: source.title,
      summary,
      quote,
    })
  } catch (error) {
    console.error('[workspace-tool/fetch-summarize] POST error:', error)
    // Distinguish timeout from generic failure. AbortSignal.timeout()
    // throws a DOMException with name "TimeoutError" (or "AbortError" in
    // older runtimes); the request's own signal abort surfaces as
    // "AbortError" too. Either way the user gets a clear, actionable
    // message instead of a generic 500.
    const isAbort = error instanceof Error && (
      error.name === 'AbortError'
      || error.name === 'TimeoutError'
      || /aborted|timeout/i.test(error.message)
    )
    const message = isAbort
      ? `Fetch timed out after ${Math.round(FETCH_TOOL_TIMEOUT_MS / 1000)}s. The site may be slow or blocking automated access.`
      : (error instanceof Error ? error.message : 'Fetch and summarize failed')
    return NextResponse.json({
      success: false,
      url,
      error: message,
    }, { status: isAbort ? 504 : 500 })
  }
}
