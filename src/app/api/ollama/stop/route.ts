import { NextResponse } from 'next/server'
import { stopRunningOllamaModel } from '@/lib/ollama-control'
import { getCurrentUserId } from '@/lib/request-auth'
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings'

interface StopModelBody {
  model?: unknown
  host?: unknown
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({})) as StopModelBody
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : ''
    if (!requestedModel) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 })
    }

    const settings = await getUserSettings(userId)
    const baseUrl = body.host === undefined
      ? settings.ollamaHost
      : normalizeOllamaHost(body.host)

    const stoppedModel = await stopRunningOllamaModel(baseUrl, requestedModel)

    return NextResponse.json({
      ok: true,
      host: baseUrl,
      model: stoppedModel || requestedModel,
      stopped: Boolean(stoppedModel),
    })
  } catch (error) {
    console.error('Ollama stop error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop Ollama model' },
      { status: 502 },
    )
  }
}
