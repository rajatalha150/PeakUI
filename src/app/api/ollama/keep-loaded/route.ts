import { NextResponse } from 'next/server'
import { ensureOllamaModelLoaded } from '@/lib/ollama-control'
import { getCurrentUserId } from '@/lib/request-auth'
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings'
import { buildOllamaKeepAlive } from '@/lib/ollama-keepalive'

const DEFAULT_OLLAMA_CLOUD_BASE_URL = 'https://ollama.com'

interface KeepLoadedBody {
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

// POST: Load the model into memory and pin it for the keep-alive duration.
// This is a no-op (skipped) when keep-alive is off, the Ollama Cloud API is
// in use, or the model is a `:cloud` alias — those never get local residency
// hints.
export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({})) as KeepLoadedBody
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : ''
    if (!requestedModel) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 })
    }

    const settings = await getUserSettings(userId)
    const { baseUrl, apiKey } = resolveOllamaBaseUrl(settings, body.host)

    const keepAlive = buildOllamaKeepAlive(settings, requestedModel)
    if (!keepAlive) {
      return NextResponse.json({
        ok: true,
        model: requestedModel,
        loaded: false,
        skipped: 'keep-alive-not-active',
        keepAlive: null,
      })
    }

    const result = await ensureOllamaModelLoaded(baseUrl, requestedModel, { keepAlive, apiKey })
    return NextResponse.json({ ok: true, ...result, keepAlive })
  } catch (error) {
    console.error('Ollama keep-loaded error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to keep Ollama model loaded' },
      { status: 502 },
    )
  }
}
