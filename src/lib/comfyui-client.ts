/**
 * ComfyUI HTTP client.
 *
 * ComfyUI is the image-generation engine that runs alongside Ollama. This
 * module wraps the small slice of its HTTP API that PeakUI needs:
 *
 *   GET  /system_stats          → GPU name + VRAM (health check)
 *   GET  /models                → list of model folders
 *   GET  /models/{folder}       → models in a folder
 *   GET  /object_info           → node types (for building workflows)
 *   POST /prompt                → run a generation workflow
 *   GET  /history/{prompt_id}   → poll status + fetch the output image
 *   GET  /view?filename=...     → fetch a generated image
 *
 * All calls are best-effort and time-bounded; a down/unreachable engine
 * returns a typed result rather than throwing, so the UI can show a clean
 * "offline" state instead of a stack trace.
 */

export interface ComfyUiSystemStats {
  online: boolean
  gpuName?: string
  vramTotalBytes?: number
  vramFreeBytes?: number
  error?: string
}

export interface ComfyUiModel {
  name: string
  pathIndex: number
}

export interface ComfyUiModelsResult {
  online: boolean
  folder: string
  models: ComfyUiModel[]
  error?: string
}

/**
 * Normalize ComfyUI's `/models/{folder}` response. The endpoint returns a
 * plain array of filenames (e.g. `["sd_turbo.safetensors"]`), not objects —
 * so we map each string to `{ name, pathIndex }`.
 */
function normalizeModelList(raw: unknown): ComfyUiModel[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry, index) => {
      if (typeof entry === 'string') return { name: entry, pathIndex: index }
      if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
        return { name: (entry as { name: string }).name, pathIndex: index }
      }
      return null
    })
    .filter((entry): entry is ComfyUiModel => entry !== null)
}

export interface ComfyUiFoldersResult {
  online: boolean
  folders: string[]
  error?: string
}

const REQUEST_TIMEOUT_MS = 8000

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`ComfyUI returned ${response.status}`)
  }
  return (await response.json()) as T
}

export async function getComfyUiSystemStats(baseUrl: string): Promise<ComfyUiSystemStats> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const data = await fetchJson<{
      devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }>
    }>(`${host}/system_stats`)
    const device = data.devices?.[0]
    return {
      online: true,
      gpuName: device?.name,
      vramTotalBytes: typeof device?.vram_total === 'number' ? device.vram_total : undefined,
      vramFreeBytes: typeof device?.vram_free === 'number' ? device.vram_free : undefined,
    }
  } catch (error) {
    return { online: false, error: error instanceof Error ? error.message : 'ComfyUI unreachable' }
  }
}

export async function listComfyUiFolders(baseUrl: string): Promise<ComfyUiFoldersResult> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const folders = await fetchJson<string[]>(`${host}/models`)
    return { online: true, folders: Array.isArray(folders) ? folders : [] }
  } catch (error) {
    return { online: false, folders: [], error: error instanceof Error ? error.message : 'ComfyUI unreachable' }
  }
}

export async function listComfyUiModels(baseUrl: string, folder: string): Promise<ComfyUiModelsResult> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const raw = await fetchJson<unknown>(`${host}/models/${encodeURIComponent(folder)}`)
    return { online: true, folder, models: normalizeModelList(raw) }
  } catch (error) {
    return { online: false, folder, models: [], error: error instanceof Error ? error.message : 'ComfyUI unreachable' }
  }
}

/**
 * The model folders that hold image-generation checkpoints. These are the
 * folders PeakUI surfaces in the model picker; the rest (loras, vae, etc.)
 * are supporting assets, not selectable generation models.
 */
export const IMAGE_GEN_MODEL_FOLDERS = ['checkpoints', 'diffusion_models'] as const

export interface ComfyUiGenerationResult {
  online: boolean
  promptId?: string
  error?: string
}

/**
 * Submit a text-to-image workflow. The workflow is the minimal default
 * ComfyUI graph: a CheckpointLoaderSimple → CLIPTextEncode (positive +
 * negative) → EmptyLatentImage → KSampler → VAEDecode → SaveImage.
 *
 * `model` is the checkpoint name (as listed by /models/checkpoints).
 */
export async function submitComfyUiTxt2Img(
  baseUrl: string,
  options: { model: string; prompt: string; negativePrompt?: string; width?: number; height?: number; steps?: number; seed?: number },
): Promise<ComfyUiGenerationResult> {
  const host = baseUrl.replace(/\/$/, '')
  const width = options.width ?? 1024
  const height = options.height ?? 1024
  const steps = options.steps ?? 20
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32)

  const workflow = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: options.model } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: options.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: options.negativePrompt ?? '', clip: ['4', 1] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'peakui', images: ['8', 0] } },
  }

  try {
    const response = await fetch(`${host}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { online: true, error: text || `ComfyUI returned ${response.status}` }
    }
    const data = (await response.json()) as { prompt_id?: string }
    return { online: true, promptId: data.prompt_id }
  } catch (error) {
    return { online: false, error: error instanceof Error ? error.message : 'ComfyUI unreachable' }
  }
}

export interface ComfyUiHistoryResult {
  online: boolean
  done: boolean
  images?: Array<{ filename: string; subfolder: string; type: string }>
  error?: string
}

/**
 * Poll a generation's history. When `done`, `images` lists the output files
 * (fetchable via /view?filename=...&subfolder=...&type=...).
 */
export async function getComfyUiHistory(baseUrl: string, promptId: string): Promise<ComfyUiHistoryResult> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const data = await fetchJson<Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>>(
      `${host}/history/${encodeURIComponent(promptId)}`,
    )
    const entry = data[promptId]
    if (!entry) return { online: true, done: false }
    const images: Array<{ filename: string; subfolder: string; type: string }> = []
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) images.push(image)
    }
    return { online: true, done: true, images }
  } catch (error) {
    return { online: false, done: false, error: error instanceof Error ? error.message : 'ComfyUI unreachable' }
  }
}

/** Build the /view URL for a generated image. */
export function comfyUiViewUrl(baseUrl: string, image: { filename: string; subfolder: string; type: string }): string {
  const host = baseUrl.replace(/\/$/, '')
  const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })
  return `${host}/view?${params.toString()}`
}
