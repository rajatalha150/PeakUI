import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { fetchPublicWebPage } from '@/lib/web-context'

export const runtime = 'nodejs'
export const maxDuration = 60

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
  const access = await requireCurrentAuthWithPermissions(['openclaw.use'], {
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

    const source = await fetchPublicWebPage(url, '', { signal: request.signal })
    if (!source) {
      return NextResponse.json({ success: false, url, error: 'Could not fetch or extract the page.' })
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
    console.error('[openclaw/fetch-summarize] POST error:', error)
    return NextResponse.json({
      success: false,
      url,
      error: error instanceof Error ? error.message : 'Fetch and summarize failed',
    }, { status: 500 })
  }
}
