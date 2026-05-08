import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/request-auth'
import {
  normalizeChatPlatform,
  normalizeHuggingFaceBaseUrl,
  normalizeOllamaHost,
  getUserSettings,
} from '@/lib/settings'
import {
  buildChatModelOptionId,
  isHuggingFaceRouterUrl,
  type ChatModelOption,
} from '@/lib/chat-platforms'

interface ChatModelLookupBody {
  platform?: unknown
  ollamaHost?: unknown
  huggingFaceBaseUrl?: unknown
  apiKey?: unknown
  api_key?: unknown
  search?: unknown
  limit?: unknown
}

interface OpenAiStyleModel {
  id?: unknown
  name?: unknown
}

function normalizeModelName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLimit(value: unknown, fallback = 40): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(100, Math.max(1, Math.round(parsed)))
}

async function fetchOllamaModels(host: string): Promise<ChatModelOption[]> {
  const response = await fetch(`${host}/api/tags`, {
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to fetch Ollama models')
  }

  const data = await response.json().catch(() => ({})) as {
    models?: Array<Record<string, unknown>>
  }

  const rawModels = Array.isArray(data.models) ? data.models : []
  return rawModels.flatMap((item) => {
    const name = normalizeModelName(item.name ?? item.model)
    if (!name) return []

    return [{
      id: buildChatModelOptionId('ollama', name),
      name,
      model: name,
      provider: 'ollama' as const,
      sourceLabel: 'Ollama',
    }]
  })
}

function mapOpenAiModels(models: unknown[], sourceLabel: string): ChatModelOption[] {
  return models.flatMap((item) => {
    const model = item as OpenAiStyleModel
    const name = normalizeModelName(model.id ?? model.name)
    if (!name) return []

    return [{
      id: buildChatModelOptionId('huggingface', name),
      name,
      model: name,
      provider: 'huggingface' as const,
      sourceLabel,
    }]
  })
}

async function fetchHuggingFaceRouterModels(baseUrl: string, apiKey: string, search: string, limit: number): Promise<ChatModelOption[]> {
  if (!apiKey) {
    throw new Error('Add a Hugging Face token in Settings to list router models')
  }

  const response = await fetch(`${baseUrl}/models`, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to fetch Hugging Face models')
  }

  const data = await response.json().catch(() => ({})) as {
    data?: unknown[]
    models?: unknown[]
  }

  const rawModels = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : []
  const normalizedSearch = search.trim().toLowerCase()

  return mapOpenAiModels(rawModels, 'Hugging Face')
    .filter((model) => !normalizedSearch || model.name.toLowerCase().includes(normalizedSearch))
    .slice(0, limit)
}

async function fetchCustomHuggingFaceModels(baseUrl: string, apiKey: string): Promise<ChatModelOption[]> {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }

  const modelsResponse = await fetch(`${baseUrl}/models`, {
    headers,
    signal: AbortSignal.timeout(10000),
  })

  if (modelsResponse.ok) {
    const data = await modelsResponse.json().catch(() => ({})) as {
      data?: unknown[]
      models?: unknown[]
    }
    const models = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
    const parsed = mapOpenAiModels(models, baseUrl)
    if (parsed.length > 0) return parsed
  }

  const infoBaseUrl = baseUrl.replace(/\/v1\/?$/i, '')
  const infoResponse = await fetch(`${infoBaseUrl}/info`, {
    headers,
    signal: AbortSignal.timeout(10000),
  })

  if (!infoResponse.ok) {
    const text = await infoResponse.text()
    throw new Error(text || 'The Hugging Face endpoint did not expose /models or /info')
  }

  const info = await infoResponse.json().catch(() => ({})) as Record<string, unknown>
  const modelId = normalizeModelName(info.model_id ?? info.modelId ?? info.model)
  if (!modelId) {
    throw new Error('The Hugging Face endpoint did not report a model id')
  }

  return [{
    id: buildChatModelOptionId('huggingface', modelId),
    name: modelId,
    model: modelId,
    provider: 'huggingface',
    sourceLabel: baseUrl,
  }]
}

async function fetchHuggingFaceModels(options: {
  baseUrl: string
  apiKey: string
  search: string
  limit: number
}): Promise<ChatModelOption[]> {
  if (isHuggingFaceRouterUrl(options.baseUrl)) {
    return fetchHuggingFaceRouterModels(options.baseUrl, options.apiKey, options.search, options.limit)
  }

  return fetchCustomHuggingFaceModels(options.baseUrl, options.apiKey)
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const settings = await getUserSettings(userId)
    const body = await req.json().catch(() => ({})) as ChatModelLookupBody
    const platform = normalizeChatPlatform(body.platform ?? settings.chatPlatform)
    const ollamaHost = normalizeOllamaHost(body.ollamaHost ?? settings.ollamaHost)
    const huggingFaceBaseUrl = normalizeHuggingFaceBaseUrl(body.huggingFaceBaseUrl ?? settings.huggingFaceBaseUrl)
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : typeof body.api_key === 'string' && body.api_key.trim()
        ? body.api_key.trim()
        : ''
    const search = normalizeSearch(body.search)
    const limit = normalizeLimit(body.limit)

    const lookups: Array<Promise<ChatModelOption[]>> = []
    if (platform === 'ollama' || platform === 'hybrid') {
      lookups.push(fetchOllamaModels(ollamaHost))
    }
    if (platform === 'huggingface' || platform === 'hybrid') {
      lookups.push(fetchHuggingFaceModels({
        baseUrl: huggingFaceBaseUrl,
        apiKey,
        search,
        limit,
      }))
    }

    const settled = await Promise.allSettled(lookups)
    const models: ChatModelOption[] = []
    const warnings: string[] = []

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        models.push(...result.value)
      } else {
        warnings.push(result.reason instanceof Error ? result.reason.message : 'Failed to fetch models')
      }
    }

    const deduped = models.filter((model, index, values) => values.findIndex(item => item.id === model.id) === index)

    return NextResponse.json({
      platform,
      models: deduped,
      warnings,
    })
  } catch (error) {
    console.error('Chat model lookup failed:', error)
    return NextResponse.json({ error: 'Failed to fetch chat models' }, { status: 500 })
  }
}
