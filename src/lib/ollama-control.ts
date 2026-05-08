import { isSameOllamaModel } from './embedding-models'

const OLLAMA_PS_TIMEOUT_MS = 4000
const OLLAMA_STOP_TIMEOUT_MS = 15000

interface OllamaPsResponse {
  models?: Array<{
    name?: unknown
    model?: unknown
  }>
}

function normalizeModelName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function createAbortSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort()
    } else {
      parentSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true })
  return controller.signal
}

export async function listRunningOllamaModels(baseUrl: string, parentSignal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/ps`, {
    signal: createAbortSignal(OLLAMA_PS_TIMEOUT_MS, parentSignal),
  })

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status} while listing running models.`)
  }

  const data = await response.json().catch(() => ({})) as OllamaPsResponse
  const models = Array.isArray(data.models) ? data.models : []

  return models
    .map(item => normalizeModelName(item.name ?? item.model))
    .filter((name, index, values) => Boolean(name) && values.indexOf(name) === index)
}

export async function stopOllamaModel(baseUrl: string, model: string, parentSignal?: AbortSignal): Promise<void> {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      keep_alive: 0,
      stream: false,
    }),
    signal: createAbortSignal(OLLAMA_STOP_TIMEOUT_MS, parentSignal),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Failed to stop "${model}" in Ollama.`)
  }
}

export async function stopRunningOllamaModel(baseUrl: string, selectedModel: string, parentSignal?: AbortSignal): Promise<string | null> {
  const runningModels = await listRunningOllamaModels(baseUrl, parentSignal)
  const runningModel = runningModels.find(model => isSameOllamaModel(model, selectedModel))

  if (!runningModel) return null

  await stopOllamaModel(baseUrl, runningModel, parentSignal)
  return runningModel
}

export async function unloadOtherOllamaModels(baseUrl: string, selectedModel: string, parentSignal?: AbortSignal): Promise<string[]> {
  const runningModels = await listRunningOllamaModels(baseUrl, parentSignal)
  const modelsToUnload = runningModels.filter(model => !isSameOllamaModel(model, selectedModel))

  if (modelsToUnload.length === 0) return []

  const results = await Promise.allSettled(
    modelsToUnload.map(model => stopOllamaModel(baseUrl, model, parentSignal))
  )

  const failures = results
    .map((result, index) => ({ result, model: modelsToUnload[index] }))
    .filter((item): item is { result: PromiseRejectedResult; model: string } => item.result.status === 'rejected')

  if (failures.length > 0) {
    const summary = failures
      .map(item => `${item.model}: ${item.result.reason instanceof Error ? item.result.reason.message : 'unknown error'}`)
      .join(' | ')
    throw new Error(`Could not unload running Ollama models before switching: ${summary}`)
  }

  return modelsToUnload
}
