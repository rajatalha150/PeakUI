import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'
import { getUserSettings } from '@/lib/settings'
import { searchHfModels, getHfModelDetail } from '@/lib/hf-client'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await getCurrentAuth()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const query = req.nextUrl.searchParams.get('q') || ''
  const modelId = req.nextUrl.searchParams.get('id') || ''

  try {
    const settings = await getUserSettings(auth.user.id)
    const token = settings.hfToken || undefined

    if (modelId) {
      const detail = await getHfModelDetail(modelId, token)
      return NextResponse.json({ detail })
    }

    const results = await searchHfModels(query, {
      pipelineTag: 'text-to-image',
      limit: 30,
      token,
    })
    return NextResponse.json({ results })
  } catch (error) {
    console.error('[image-gen/search] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Hugging Face search failed' },
      { status: 502 },
    )
  }
}
