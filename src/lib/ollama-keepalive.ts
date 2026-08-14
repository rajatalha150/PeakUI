/**
 * Request-level `keep_alive` resolution for Ollama.
 *
 * Keep-alive is a LOCAL-Ollama feature: it asks the local runner to keep a
 * model resident in VRAM between requests (or unload it with `0`). It is never
 * sent to the Ollama Cloud API (no local model to keep resident) nor to
 * `:cloud` model aliases, which are remote by definition.
 */

export function isOllamaCloudModel(model: string): boolean {
  return /:cloud$/i.test(model.trim())
}

export interface KeepAliveSettings {
  modelKeepAlive: boolean
  ollamaKeepAlive: string
  ollamaUseCloudApi: boolean
}

/**
 * Resolve the `keep_alive` duration to send with an Ollama request, or
 * undefined when the feature is off or not applicable. `AppSettings` satisfies
 * `KeepAliveSettings` structurally, so callers can pass it directly.
 */
export function buildOllamaKeepAlive(settings: KeepAliveSettings, model: string): string | undefined {
  if (!settings.modelKeepAlive || settings.ollamaUseCloudApi || isOllamaCloudModel(model)) return undefined
  return settings.ollamaKeepAlive === '0' ? undefined : settings.ollamaKeepAlive
}
