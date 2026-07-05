import { NextResponse } from 'next/server'
import { stopRunningOllamaModel } from '@/lib/ollama-control'
import { getCurrentUserId } from '@/lib/request-auth'
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings'

const DEFAULT_OLLAMA_CLOUD_BASE_URL = 'https://ollama.com'

interface StopModelBody {
  model?: unknown
  host?: unknown
}

function resolveOllamaBaseUrl(settings: Awaited<ReturnType<typeof getUserSettings>>, overrideHost?: unknown): { baseUrl: string; apiKey: string } {
  if (settings.ollamaUseCloudApi) {
    return { baseUrl: DEFAULT_OLLAMA_CLOUD_BASE_URL, apiKey: settings.ollamaApiKey }
  }
  const baseUrl = overrideHost === undefined
    ? settings.ollamaHost
    : normalizeOllamaHost(overrideHost)
  return { baseUrl, apiKey: '' }
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
    const { baseUrl, apiKey } = resolveOllamaBaseUrl(settings, body.host)

    const stoppedModel = await stopRunningOllamaModel(baseUrl, requestedModel, apiKey)

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
