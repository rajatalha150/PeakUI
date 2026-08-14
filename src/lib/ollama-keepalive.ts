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

/**
 * Parse an Ollama-style keep-alive duration into milliseconds.
 * Accepts `ms`, `s`, `m`, and `h` suffixes ("30m", "1h", "1500ms", "45s").
 * Returns 0 for unparseable values and for "0" (the unload sentinel).
 */
export function parseKeepAliveMs(value: string): number {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const match = /^(\d+)(ms|s|m|h)$/.exec(raw)
  if (!match) return 0
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return Number(match[1]) * multipliers[match[2]]
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
