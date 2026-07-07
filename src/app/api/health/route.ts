import { NextResponse } from 'next/server'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import { getUserSettings } from '@/lib/settings'
import { getErrorMessage } from '@/lib/rag'

interface OllamaHealth {
  ok: boolean
  latencyMs: number
  error?: string
  reachable: boolean
  models: string[]
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { maxRetries: number; delaysMs: number[] },
): Promise<Response> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const response = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      return response
    } catch (error) {
      lastError = error
      if (attempt < options.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, options.delaysMs[attempt] ?? options.delaysMs[options.delaysMs.length - 1]))
      }
    }
  }

  throw lastError ?? new Error(`Failed to reach ${url}`)
}

async function checkOllamaHealth(ollamaHost: string, apiKey: string | null | undefined): Promise<OllamaHealth> {
  const startedAt = performance.now()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  try {
    const tagsResponse = await fetchWithRetry(`${ollamaHost}/api/tags`, { method: 'GET', headers }, {
      maxRetries: 3,
      delaysMs: [1000, 3000, 7000],
    })

    if (!tagsResponse.ok) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        reachable: true,
        error: `Ollama returned ${tagsResponse.status}: ${await tagsResponse.text().catch(() => 'unknown')}`,
        models: [],
      }
    }

    const data = (await tagsResponse.json()) as { models?: Array<{ name: string; model?: string }> }
    const models = (data.models ?? []).map(m => m.model || m.name)

    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
      reachable: true,
      models,
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      reachable: false,
      error: getErrorMessage(error),
      models: [],
    }
  }
}

export async function GET(req: Request) {
  try {
    const userId = await getCurrentUserIdWithPermission('knowledge.use')
    if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const settings = await getUserSettings(userId)
    const chatHealth = await checkOllamaHealth(settings.ollamaHost, settings.ollamaApiKey)
    const ragHealth = settings.ragMode === 'semantic'
      ? await checkOllamaHealth(settings.ollamaHost, settings.ollamaApiKey)
      : { ok: true, latencyMs: 0, reachable: true, models: [] }

    return NextResponse.json({
      ok: chatHealth.ok && ragHealth.ok,
      chatModel: settings.chatModel,
      ragModel: settings.ragModel,
      chat: chatHealth,
      rag: ragHealth,
      ragMode: settings.ragMode,
    })
  } catch (error) {
    console.error('Health check failed:', error)
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 })
  }
}
