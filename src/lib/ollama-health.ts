export type OllamaHealthStatus = 'online' | 'degraded' | 'offline'

export interface OllamaHealthSummary {
  ok: boolean
  status: OllamaHealthStatus
  host: string
  online: boolean
  version: string
  installedModelCount: number
  loadedModelCount: number
  loadedModels: string[]
  selectedModel: string
  selectedModelLoaded: boolean
  error: string
  checkedAt: number
}
