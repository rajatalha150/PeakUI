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
 *   POST /free                  → unload models / free VRAM (VRAM sequencing)
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
 * List diffusers-format models. ComfyUI's `/models/diffusers` endpoint returns
 * an empty list (the `diffusers` folder type holds subfolders, not files), so
 * we read the `DiffusersLoader` node's `model_path` options instead — those
 * are the folder names that contain a `model_index.json`.
 */
export async function listComfyUiDiffusersModels(baseUrl: string): Promise<ComfyUiModelsResult> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const data = await fetchJson<{ DiffusersLoader?: { input?: { required?: { model_path?: unknown } } } }>(
      `${host}/object_info/DiffusersLoader`,
    )
    const options = data.DiffusersLoader?.input?.required?.model_path
    const list = Array.isArray(options) ? (Array.isArray(options[0]) ? options[0] : options) : []
    return {
      online: true,
      folder: 'diffusers',
      models: list.filter((name): name is string => typeof name === 'string').map((name, index) => ({ name, pathIndex: index })),
    }
  } catch (error) {
    return { online: false, folder: 'diffusers', models: [], error: error instanceof Error ? error.message : 'ComfyUI unreachable' }
  }
}

/**
 * Determine whether a model name refers to a diffusers-format model (a folder
 * under `models/diffusers/`) or a single-file checkpoint. Returns 'diffusers'
 * when the name is in the DiffusersLoader list, else 'checkpoint'.
 */
export async function detectComfyUiModelKind(baseUrl: string, model: string): Promise<'checkpoint' | 'diffusers' | 'split'> {
  const diffusers = await listComfyUiDiffusersModels(baseUrl)
  if (diffusers.models.some(m => m.name === model)) return 'diffusers'
  const split = await listComfyUiSplitModels(baseUrl)
  if (split.models.some(m => m.name === model)) return 'split'
  return 'checkpoint'
}

/**
 * List split-format models (UNet files in `models/diffusion_models/`). These
 * are the modern ComfyUI-native models (Anima, Z-Image, Qwen-Image) where the
 * UNet, text encoder, and VAE are separate files.
 */
export async function listComfyUiSplitModels(baseUrl: string): Promise<ComfyUiModelsResult> {
  return listComfyUiModels(baseUrl, 'diffusion_models')
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

  return submitWorkflow(host, workflow)
}

/**
 * Submit a text-to-image workflow for a diffusers-format model. Uses
 * `DiffusersLoader` (which loads a full diffusers folder into MODEL + CLIP +
 * VAE) instead of `CheckpointLoaderSimple`.
 *
 * `model` is the diffusers folder name (as listed by the DiffusersLoader node).
 */
export async function submitComfyUiTxt2ImgDiffusers(
  baseUrl: string,
  options: { model: string; prompt: string; negativePrompt?: string; width?: number; height?: number; steps?: number; seed?: number },
): Promise<ComfyUiGenerationResult> {
  const host = baseUrl.replace(/\/$/, '')
  const width = options.width ?? 1024
  const height = options.height ?? 1024
  const steps = options.steps ?? 20
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32)

  const workflow = {
    '4': { class_type: 'DiffusersLoader', inputs: { model_path: options.model } },
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

  return submitWorkflow(host, workflow)
}

/**
 * Submit a text-to-image workflow for a split-format model. Uses UNETLoader +
 * CLIPLoader + VAELoader (the modern ComfyUI-native layout where the UNet,
 * text encoder, and VAE are separate files).
 *
 * `model` is the UNet filename (in `models/diffusion_models/`), `clipName` is
 * the text-encoder filename (in `models/text_encoders/`), `vaeName` is the VAE
 * filename (in `models/vae/`), and `clipType` is the CLIPLoader type (e.g.
 * `qwen_image`, `flux`, `sdxl`).
 */
export async function submitComfyUiTxt2ImgSplit(
  baseUrl: string,
  options: {
    model: string
    clipName: string
    vaeName: string
    clipType: string
    prompt: string
    negativePrompt?: string
    width?: number
    height?: number
    steps?: number
    seed?: number
  },
): Promise<ComfyUiGenerationResult> {
  const host = baseUrl.replace(/\/$/, '')
  const width = options.width ?? 1024
  const height = options.height ?? 1024
  const steps = options.steps ?? 20
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32)

  const workflow = {
    '4': { class_type: 'UNETLoader', inputs: { unet_name: options.model, weight_dtype: 'default' } },
    '10': { class_type: 'CLIPLoader', inputs: { clip_name: options.clipName, type: options.clipType } },
    '11': { class_type: 'VAELoader', inputs: { vae_name: options.vaeName } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: options.prompt, clip: ['10', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: options.negativePrompt ?? '', clip: ['10', 0] } },
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
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['11', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'peakui', images: ['8', 0] } },
  }

  return submitWorkflow(host, workflow)
}

async function submitWorkflow(host: string, workflow: Record<string, unknown>): Promise<ComfyUiGenerationResult> {
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
  /** Execution error detail (node type + exception message) when the workflow failed. */
  error?: string
}

/**
 * Poll a generation's history. When `done`, `images` lists the output files
 * (fetchable via /view?filename=...&subfolder=...&type=...). If the workflow
 * failed, `error` carries the node type + exception message so the failure is
 * actionable instead of a generic "no images".
 */
export async function getComfyUiHistory(baseUrl: string, promptId: string): Promise<ComfyUiHistoryResult> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    const data = await fetchJson<Record<string, {
      outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>
      status?: { status_str?: string; completed?: boolean; messages?: Array<[string, unknown]> }
    }>>(
      `${host}/history/${encodeURIComponent(promptId)}`,
    )
    const entry = data[promptId]
    if (!entry) return { online: true, done: false }
    const images: Array<{ filename: string; subfolder: string; type: string }> = []
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) images.push(image)
    }

    // Extract execution errors so failures are actionable.
    let error: string | undefined
    for (const message of entry.status?.messages ?? []) {
      if (message[0] !== 'execution_error') continue
      const detail = message[1] as { node_type?: string; exception_message?: string } | undefined
      if (detail?.exception_message) {
        const nodeType = detail.node_type ? `${detail.node_type}: ` : ''
        error = `${nodeType}${detail.exception_message.trim()}`
      }
    }

    return { online: true, done: true, images, error }
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

/**
 * Ask ComfyUI to unload resident model weights and free VRAM. Used by the VRAM
 * sequencer before a generation so two big consumers never fight for memory.
 * Best-effort: failure never blocks generation.
 */
export async function freeComfyUiMemory(baseUrl: string): Promise<void> {
  const host = baseUrl.replace(/\/$/, '')
  try {
    await fetch(`${host}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    // Best-effort: ComfyUI manages its own VRAM if this fails.
  }
}
