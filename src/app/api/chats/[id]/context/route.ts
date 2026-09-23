import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/request-auth'
import { getChatSessionById } from '@/lib/chat-sessions'
import { recallContextEpisodes } from '@/lib/context-ledger'

export const runtime = 'nodejs'

/**
 * Read-only, owner-scoped context recall. This is intentionally separate from
 * the transcript route so the UI and future agent tools can inspect compacted
 * work without loading an entire long-running conversation into the browser.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await context.params
    const session = await getChatSessionById(userId, id)
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const query = request.nextUrl.searchParams.get('query')?.trim().slice(0, 2_000) || ''
    if (!query) return NextResponse.json({ error: 'A recall query is required' }, { status: 400 })
    return NextResponse.json(await recallContextEpisodes(session.id, query))
  } catch (error) {
    console.error('Context recall request failed:', error)
    return NextResponse.json({ error: 'Unable to recall context' }, { status: 500 })
  }
}
