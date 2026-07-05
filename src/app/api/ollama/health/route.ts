import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/request-auth'
import { isSameOllamaModel } from '@/lib/embedding-models'
import { getUserSettings, normalizeOllamaHost } from '@/lib/settings'
import { getErrorMessage } from '@/lib/rag'

const DEFAULT_OLLAMA_CLOUD_BASE_URL = 'https://ollama.com'

interface OllamaVersionResponse {
  version?: unknown
}

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown }>
}

interface OllamaPsResponse {
  models?: Array<{ name?: unknown; model?: unknown; expires_at?: unknown; context_length?: unknown }>
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveOllamaBaseUrl(settings: Awaited<ReturnType<typeof getUserSettings>>, overrideHost?: string | null): { baseUrl: string; apiKey: string } {
  if (settings.ollamaUseCloudApi) {
    return { baseUrl: DEFAULT_OLLAMA_CLOUD_BASE_URL, apiKey: settings.ollamaApiKey }
  }
  const host = overrideHost ? normalizeOllamaHost(overrideHost) : settings.ollamaHost
  return { baseUrl: host, apiKey: '' }
}

async function fetchJson<T>(url: string, apiKey: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      ...(apiKey.trim() ? { Authorization: 'Bearer ' + apiKey.trim() } : {}),
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Ollama returned ${response.status} for ${url}`)
  }

  return await response.json().catch(() => ({})) as T
}

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await getUserSettings(userId)
  const overrideHost = req.nextUrl.searchParams.get('host')
  const selectedModel = req.nextUrl.searchParams.get('model') || ''
  const { baseUrl: host, apiKey } = resolveOllamaBaseUrl(settings, overrideHost)

  try {
    const psPromise = settings.ollamaUseCloudApi
      ? Promise.resolve({ models: [] })
      : fetchJson<OllamaPsResponse>(`${host}/api/ps`, apiKey)
          .then(data => ({ data }))
          .catch(error => ({ error }))

    const [versionData, tagsData, psResult] = await Promise.all([
      fetchJson<OllamaVersionResponse>(`${host}/api/version`, apiKey),
      fetchJson<OllamaTagsResponse>(`${host}/api/tags`, apiKey),
      psPromise,
    ])

    const installedModels = Array.isArray(tagsData.models)
      ? tagsData.models.map(model => normalizeName(model?.name)).filter(Boolean)
      : []
    const psError = 'error' in psResult ? psResult.error : null
    const loadedModelDetails = !psError && 'data' in psResult && Array.isArray(psResult.data.models)
      ? psResult.data.models
        .map(model => ({
          name: normalizeName(model?.name ?? model?.model),
          expiresAt: typeof model?.expires_at === 'string' ? model.expires_at : '',
          contextLength: typeof model?.context_length === 'number' ? model.context_length : null,
        }))
        .filter((model, index, values) => Boolean(model.name) && values.findIndex(entry => entry.name === model.name) === index)
      : []
    const loadedModels = loadedModelDetails.map(model => model.name)
    const selectedModelDetail = Boolean(selectedModel)
      ? loadedModelDetails.find(model => isSameOllamaModel(model.name, selectedModel))
      : undefined

    return NextResponse.json({
      ok: !psError,
      status: psError ? 'degraded' : 'online',
      host,
      online: true,
      version: typeof versionData.version === 'string' ? versionData.version : '',
      installedModelCount: installedModels.length,
      loadedModelCount: loadedModels.length,
      loadedModels,
      loadedModelDetails,
      selectedModel,
      selectedModelLoaded: Boolean(selectedModelDetail),
      selectedModelExpiresAt: selectedModelDetail?.expiresAt || '',
      modelKeepAlive: settings.modelKeepAlive,
      ollamaKeepAlive: settings.ollamaKeepAlive,
      error: psError instanceof Error ? psError.message : '',
      checkedAt: Date.now(),
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 'offline',
      host,
      online: false,
      version: '',
      installedModelCount: 0,
      loadedModelCount: 0,
      loadedModels: [],
      loadedModelDetails: [],
      selectedModel,
      selectedModelLoaded: false,
      selectedModelExpiresAt: '',
      modelKeepAlive: settings.modelKeepAlive,
      ollamaKeepAlive: settings.ollamaKeepAlive,
      error: getErrorMessage(error, 'Failed to contact Ollama. Is the local service running?'),
      checkedAt: Date.now(),
    })
  }
}
