// Detects whether a model can accept image input ("vision"). For local Ollama
// models we ask the daemon directly via /api/show (authoritative). When that is
// unavailable, or for OpenAI-compatible providers, we fall back to a name-based
// heuristic covering the common multimodal families.

const VISION_NAME_PATTERNS: RegExp[] = [
  /llava/i,
  /bakllava/i,
  /vision/i,
  /\bvl\b/i,
  /-vl[-:]/i,
  /qwen[\d.]*-?vl/i,
  /minicpm-?v/i,
  /moondream/i,
  /pixtral/i,
  /internvl/i,
  /cogvlm/i,
  /glm-?4v/i,
  /idefics/i,
  /smolvlm/i,
  /deepseek-?vl/i,
  /yi-?vl/i,
  /paligemma/i,
  /aya-?vision/i,
  /granite[\d.]*-?vision/i,
  /\bgemma\s*3\b/i,
  /gemma3/i,
  /llama\s*4/i,
  /llama4/i,
  /mistral-?small-?3\.[1-9]/i,
  /phi-?3.*vision/i,
  /phi-?4.*multimodal/i,
  /got-?ocr/i,
  /nanonets-?ocr/i,
  // Cloud multimodal families (OpenAI-compatible providers).
  /gpt-?4o/i,
  /gpt-?4\.1/i,
  /gpt-?5/i,
  /\bo[34]\b/i,
  /claude-?3/i,
  /claude-?4/i,
  /claude.*(sonnet|opus|haiku)/i,
  /gemini/i,
  /grok.*vision/i,
  /grok-?[24]/i,
]

export function modelNameSuggestsVision(model: string): boolean {
  const name = model.trim()
  if (!name) return false
  return VISION_NAME_PATTERNS.some(pattern => pattern.test(name))
}

interface OllamaShowResponse {
  capabilities?: unknown
}

export async function fetchOllamaModelCapabilities(
  baseUrl: string,
  model: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const response = await fetch(`${host}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, name: model }),
      signal,
    })
    if (!response.ok) return null
    const data = (await response.json().catch(() => null)) as OllamaShowResponse | null
    if (!data || !Array.isArray(data.capabilities)) return null
    return data.capabilities.filter((value): value is string => typeof value === 'string')
  } catch {
    return null
  }
}

export async function detectModelVision(options: {
  provider: 'ollama' | 'openai-compatible'
  baseUrl: string
  model: string
  signal?: AbortSignal
}): Promise<boolean> {
  const { provider, baseUrl, model } = options
  if (!model.trim()) return false

  if (provider === 'ollama') {
    const capabilities = await fetchOllamaModelCapabilities(baseUrl, model, options.signal)
    if (capabilities) {
      return capabilities.some(capability => capability.toLowerCase() === 'vision')
    }
  }

  return modelNameSuggestsVision(model)
}
