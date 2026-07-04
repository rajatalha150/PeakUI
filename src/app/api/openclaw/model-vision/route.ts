import { NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getUserSettings, normalizeOllamaHost, normalizeOpenClawProvider } from '@/lib/settings'
import { detectModelVision } from '@/lib/vision-capability'

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1'

export async function POST(req: Request) {
  try {
    const access = await requireCurrentAuthWithPermissions(['openclaw.use'], {
      forbiddenMessage: 'WorkSpaces access is not granted for this account.',
      actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before using WorkSpaces.',
    })
    if ('response' in access) return access.response

    const settings = await getUserSettings(access.userId)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 })
    }

    const provider = normalizeOpenClawProvider(body.provider ?? settings.openClawProvider) === 'openai-compatible'
      ? 'openai-compatible'
      : 'ollama'

    const rawBaseUrl = body.base_url ?? body.baseUrl
      ?? (provider === 'openai-compatible' ? settings.openClawBaseUrl : settings.ollamaHost)
    const baseUrl = provider === 'openai-compatible'
      ? (typeof rawBaseUrl === 'string' && rawBaseUrl.trim() ? rawBaseUrl.trim() : DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
      : settings.ollamaUseCloudApi
        ? 'https://ollama.com/api'
        : normalizeOllamaHost(rawBaseUrl)
    const apiKey = provider === 'ollama' && settings.ollamaUseCloudApi ? settings.ollamaApiKey : ''

    const vision = await detectModelVision({ provider, baseUrl, model, apiKey })

    return NextResponse.json({ model, provider, vision })
  } catch (error) {
    console.error('Model vision detection failed:', error)
    return NextResponse.json({ error: 'Failed to detect model vision capability' }, { status: 500 })
  }
}
