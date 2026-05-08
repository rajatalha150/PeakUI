export type ChatPlatform = 'ollama' | 'huggingface' | 'hybrid'
export type ChatModelProvider = 'ollama' | 'huggingface'

export interface ChatModelOption {
  id: string
  name: string
  model: string
  provider: ChatModelProvider
  sourceLabel: string
}

export const DEFAULT_HUGGING_FACE_BASE_URL = 'https://router.huggingface.co/v1'

export function normalizeChatPlatform(value: unknown): ChatPlatform {
  if (value === 'huggingface') return 'huggingface'
  if (value === 'hybrid') return 'hybrid'
  return 'ollama'
}

export function normalizeChatModelProvider(value: unknown): ChatModelProvider {
  return value === 'huggingface' ? 'huggingface' : 'ollama'
}

export function normalizeHuggingFaceBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_HUGGING_FACE_BASE_URL

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const pathname = url.pathname.replace(/\/$/, '')
    if (!pathname || pathname === '/') return `${url.origin}/v1`
    return `${url.origin}${pathname.endsWith('/v1') ? pathname : `${pathname}/v1`}`
  } catch {
    const trimmed = raw.replace(/\/$/, '')
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
  }
}

export function buildChatModelOptionId(provider: ChatModelProvider, model: string): string {
  return `${provider}::${model}`
}

export function parseChatModelOptionId(value: unknown): { provider: ChatModelProvider; model: string } | null {
  if (typeof value !== 'string') return null
  const dividerIndex = value.indexOf('::')
  if (dividerIndex === -1) return null

  const provider = normalizeChatModelProvider(value.slice(0, dividerIndex))
  const model = value.slice(dividerIndex + 2).trim()
  if (!model) return null

  return { provider, model }
}

export function isHuggingFaceRouterUrl(value: unknown): boolean {
  const normalized = normalizeHuggingFaceBaseUrl(value).toLowerCase()
  return normalized === DEFAULT_HUGGING_FACE_BASE_URL
}
