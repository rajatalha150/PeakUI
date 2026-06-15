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
  loadedModelDetails?: Array<{
    name: string
    expiresAt: string
    contextLength?: number | null
  }>
  selectedModel: string
  selectedModelLoaded: boolean
  selectedModelExpiresAt?: string
  modelKeepAlive?: boolean
  ollamaKeepAlive?: string
  error: string
  checkedAt: number
}
