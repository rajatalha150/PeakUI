import { getUserSettings, normalizeOllamaHost, normalizeWorkspaceToolProvider } from './settings'
import { detectModelVision } from './vision-capability'
import {
  buildWorkspaceVisionPrompt,
  extractWorkspaceVisionText,
  normalizeVisionImageData,
  normalizeVisionMimeType,
  WORKSPACE_VISION_SYSTEM_PROMPT,
  type WorkspaceVisionImage,
} from './workspace-vision'

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_OLLAMA_CLOUD_BASE_URL = 'https://ollama.com'
const MAX_IMAGES = 16
const MAX_IMAGE_DATA_CHARS = 20 * 1024 * 1024

export interface WorkspaceVisionAnalysis {
  model: string
  provider: 'ollama' | 'openai-compatible' | ''
  usedDelegate: boolean
  mainModelSupportsVision: boolean
  observations: string
  reason?: string
}

function normalizeBaseUrl(value: unknown, provider: 'ollama' | 'openai-compatible', fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return fallback
  if (provider === 'ollama') return normalizeOllamaHost(raw)
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const pathname = url.pathname.replace(/\/$/, '')
    return `${url.origin}${pathname && pathname !== '/v1' ? `${pathname}/v1` : '/v1'}`.replace(/\/v1\/v1$/, '/v1')
  } catch {
    const trimmed = raw.replace(/\/$/, '')
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
  }
}

export function normalizeWorkspaceVisionImages(value: unknown): WorkspaceVisionImage[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_IMAGES).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as { name?: unknown; type?: unknown; data?: unknown }
    const data = typeof item.data === 'string' ? item.data.trim() : ''
    if (!data || data.length > MAX_IMAGE_DATA_CHARS) return []
    return [{
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `attachment-${index + 1}`,
      type: typeof item.type === 'string' ? item.type : '',
      data,
    }]
  })
}

async function callVisionModel(options: {
  provider: 'ollama' | 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
  images: WorkspaceVisionImage[]
  userText: string
}) {
  const normalizedImages = options.images.map(image => {
    const normalized = normalizeVisionImageData(image.data)
    return {
      ...image,
      data: normalized.data,
      type: normalizeVisionMimeType(normalized.mimeType || image.type, image.name),
    }
  })
  const prompt = buildWorkspaceVisionPrompt(normalizedImages, options.userText)
  const url = options.provider === 'ollama'
    ? `${options.baseUrl}/api/chat`
    : `${options.baseUrl}/chat/completions`
  const body = options.provider === 'ollama'
    ? {
        model: options.model,
        stream: false,
        messages: [{ role: 'system', content: WORKSPACE_VISION_SYSTEM_PROMPT }, {
          role: 'user',
          content: prompt,
          images: normalizedImages.map(image => image.data),
        }],
        options: { temperature: 0.1 },
      }
    : {
        model: options.model,
        temperature: 0.1,
        max_tokens: 1800,
        messages: [{ role: 'system', content: WORKSPACE_VISION_SYSTEM_PROMPT }, {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...normalizedImages.map(image => ({
              type: 'image_url',
              image_url: { url: `data:${image.type};base64,${image.data}` },
            })),
          ],
        }],
      }
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(110_000),
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }))
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `HTTP ${response.status}`
    throw new Error(`Vision model request failed: ${detail}`)
  }
  const text = extractWorkspaceVisionText(payload)
  if (!text) throw new Error('The selected Vision model returned no analysis.')
  return text
}

export async function analyzeWorkspaceImagesForUser(options: {
  userId: string
  images: WorkspaceVisionImage[]
  userText?: string
  mainModelSupportsVision: boolean
  apiKeyOverride?: string
}): Promise<WorkspaceVisionAnalysis> {
  const settings = await getUserSettings(options.userId)
  const provider = normalizeWorkspaceToolProvider(settings.workspaceToolProvider) === 'openai-compatible'
    ? 'openai-compatible'
    : 'ollama'
  const model = settings.workspaceToolVisionModel.trim()
  if (!model) {
    return {
      model: '',
      provider: '',
      usedDelegate: false,
      mainModelSupportsVision: options.mainModelSupportsVision,
      observations: '',
      reason: options.mainModelSupportsVision ? 'main-model' : 'no-vision-model-configured',
    }
  }

  const baseUrl = provider === 'ollama'
    ? settings.ollamaUseCloudApi
      ? DEFAULT_OLLAMA_CLOUD_BASE_URL
      : normalizeOllamaHost(settings.ollamaHost)
    : normalizeBaseUrl(settings.workspaceToolBaseUrl, provider, DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
  const apiKey = options.apiKeyOverride?.trim()
    || (provider === 'ollama' && settings.ollamaUseCloudApi ? settings.ollamaApiKey : '')
  const vision = await detectModelVision({ provider, baseUrl, model, apiKey })
  if (!vision) throw new Error(`The configured WorkSpaces Vision model "${model}" does not report image support.`)
  const observations = await callVisionModel({
    provider,
    baseUrl,
    apiKey,
    model,
    images: options.images,
    userText: options.userText || '',
  })
  return {
    model,
    provider,
    usedDelegate: true,
    mainModelSupportsVision: options.mainModelSupportsVision,
    observations,
  }
}
