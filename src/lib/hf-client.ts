/**
 * Hugging Face Hub client (search + model metadata).
 *
 * PeakUI lets users search Hugging Face for image-generation models and
 * download them into the ComfyUI engine. This module wraps the two read-only
 * endpoints we need:
 *
 *   GET https://huggingface.co/api/models?search=...&pipeline_tag=text-to-image
 *   GET https://huggingface.co/api/models/{id}
 *
 * The download itself (resumable, persistent) lives in the download manager,
 * not here — this is just discovery + metadata.
 */

export interface HfModelSummary {
  id: string
  pipelineTag?: string
  downloads?: number
  likes?: number
  libraryName?: string
  tags?: string[]
  /** Classification of the repo's contents, used to filter/tag search results. */
  kind?: HfModelKind
}

export type HfModelKind = 'checkpoint' | 'diffusers' | 'split' | 'collection' | 'unknown'

export interface HfModelFile {
  rfilename: string
  size?: number
}

export interface HfModelDetail extends HfModelSummary {
  siblings: HfModelFile[]
  gated?: boolean
}

const HF_API_BASE = 'https://huggingface.co/api'
const REQUEST_TIMEOUT_MS = 15000

function authHeaders(token?: string): Record<string, string> {
  return token?.trim() ? { Authorization: 'Bearer ' + token.trim() } : {}
}

/**
 * Classify a repo by its file layout:
 *   - 'checkpoint': has a root-level .safetensors/.ckpt (single-file model).
 *   - 'diffusers': has unet/ + vae/ + text_encoder/ subfolders (folder model).
 *   - 'split': has diffusion_models/ + text_encoders/ + vae/ subfolders
 *     (modern split-format model: UNet + text encoder + VAE as separate files).
 *   - 'collection': many loose files/folders but no single loadable checkpoint.
 *   - 'unknown': no recognizable model files at all.
 */
export function classifyHfModelKind(siblings: HfModelFile[]): HfModelKind {
  const files = siblings.map(s => s.rfilename)

  // Diffusers layout takes priority: a repo with unet/ + vae/ + text_encoder/
  // (and a model_index.json) is a folder-based model, even if it also ships a
  // root .safetensors (which is then just the UNet, not a full checkpoint).
  const hasUnet = files.some(f => /^unet\//i.test(f))
  const hasVae = files.some(f => /^vae\//i.test(f))
  const hasTextEncoder = files.some(f => /^(text_encoder|text_encoder_2|clip)\//i.test(f))
  if (hasUnet && hasVae && hasTextEncoder) return 'diffusers'

  // Split-format model: diffusion_models/ + text_encoders/ + vae/ folders
  // (e.g. Anima, Z-Image, Qwen-Image). These are the modern ComfyUI-native
  // layout where the UNet, text encoder, and VAE are separate files.
  const hasDiffusionModels = files.some(f => /^diffusion_models\//i.test(f))
  const hasTextEncoders = files.some(f => /^text_encoders\//i.test(f))
  const hasVaeFolder = files.some(f => /^vae\//i.test(f))
  if (hasDiffusionModels && hasTextEncoders && hasVaeFolder) return 'split'

  // A real single-file checkpoint: root-level, not a shard, not a text encoder.
  const hasRootCheckpoint = files.some(f =>
    !f.includes('/')
    && /\.(safetensors|ckpt)$/i.test(f)
    && !isShardFile(f, files)
    && !isTextEncoderFile(f),
  )
  if (hasRootCheckpoint) return 'checkpoint'

  const hasAnyModelFile = files.some(f => /\.(safetensors|ckpt|gguf|pt|pth|bin)$/i.test(f))
  return hasAnyModelFile ? 'collection' : 'unknown'
}

export async function searchHfModels(
  query: string,
  options: { pipelineTag?: string; limit?: number; token?: string } = {},
): Promise<HfModelSummary[]> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('search', query.trim())
  if (options.pipelineTag) params.set('pipeline_tag', options.pipelineTag)
  params.set('sort', 'downloads')
  params.set('direction', '-1')
  params.set('limit', String(options.limit ?? 20))
  params.set('full', 'true')

  const response = await fetch(`${HF_API_BASE}/models?${params.toString()}`, {
    headers: authHeaders(options.token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Hugging Face search failed: ${response.status}`)

  const data = (await response.json()) as Array<{
    id?: string
    pipeline_tag?: string
    downloads?: number
    likes?: number
    library_name?: string
    tags?: string[]
    siblings?: Array<{ rfilename?: string; size?: number }>
  }>

  return data
    .filter(entry => typeof entry.id === 'string')
    .map(entry => {
      const siblings = (entry.siblings ?? [])
        .filter(s => typeof s.rfilename === 'string')
        .map(s => ({ rfilename: s.rfilename as string, size: s.size }))
      return {
        id: entry.id as string,
        pipelineTag: entry.pipeline_tag,
        downloads: entry.downloads,
        likes: entry.likes,
        libraryName: entry.library_name,
        tags: entry.tags,
        kind: classifyHfModelKind(siblings),
      }
    })
}

export async function getHfModelDetail(modelId: string, token?: string): Promise<HfModelDetail> {
  // The model id is a path segment (owner/name), not a query param — the `/`
  // must stay literal. encodeURIComponent would turn it into %2F, which HF
  // rejects with 400.
  const response = await fetch(`${HF_API_BASE}/models/${modelId}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Hugging Face model lookup failed: ${response.status}`)

  const data = (await response.json()) as {
    id?: string
    pipeline_tag?: string
    downloads?: number
    likes?: number
    library_name?: string
    tags?: string[]
    gated?: boolean | string
    siblings?: Array<{ rfilename?: string; size?: number }>
  }

  return {
    id: data.id ?? modelId,
    pipelineTag: data.pipeline_tag,
    downloads: data.downloads,
    likes: data.likes,
    libraryName: data.library_name,
    tags: data.tags,
    gated: data.gated === true || data.gated === 'auto',
    siblings: (data.siblings ?? [])
      .filter(s => typeof s.rfilename === 'string')
      .map(s => ({ rfilename: s.rfilename as string, size: s.size })),
  }
}

/**
 * The ComfyUI target folder for a given HF file, based on its path. This maps
 * the diffusers layout (unet/, vae/, text_encoder/) and single-file checkpoints
 * into ComfyUI's folder structure.
 */
export function comfyFolderForHfFile(rfilename: string): string {
  const lower = rfilename.toLowerCase()
  if (lower.startsWith('unet/') || lower.startsWith('diffusion_models/')) return 'diffusion_models'
  if (lower.startsWith('vae/')) return 'vae'
  if (lower.startsWith('text_encoder/') || lower.startsWith('text_encoder_2/') || lower.startsWith('clip/')) return 'text_encoders'
  if (lower.startsWith('loras/')) return 'loras'
  // Single-file checkpoints (.safetensors / .ckpt at the root) go to checkpoints.
  if (lower.endsWith('.safetensors') || lower.endsWith('.ckpt')) return 'checkpoints'
  return 'checkpoints'
}

/** The HF resolve URL for a file (redirects to the CDN, supports Range). */
export function hfResolveUrl(modelId: string, rfilename: string): string {
  return `https://huggingface.co/${modelId}/resolve/main/${rfilename}`
}

/**
 * A sharded model file: ends in `_1`, `_2`, `-1`, `-2`, etc. before the
 * extension (e.g. `z_image_turbo_bf16_fp8_scaled_1.safetensors`). These are
 * parts of a multi-file model, not a single loadable checkpoint.
 *
 * To avoid false positives on versioned names like `dreamshaper_7.ckpt`, a
 * numbered file is only treated as a shard when a *sibling* shares the same
 * base name with a different number (e.g. `..._1` and `..._2`).
 */
function isShardFile(name: string, allNames: string[]): boolean {
  const match = /^(.*)[_-](\d+)\.(safetensors|ckpt)$/i.exec(name)
  if (!match) return false
  const base = match[1]
  const ext = match[3]
  return allNames.some(other => {
    if (other === name) return false
    const otherMatch = new RegExp(`^${escapeRegExp(base)}[_-]\\d+\\.${ext}$`, 'i').exec(other)
    return otherMatch !== null
  })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A text-encoder file (CLIP/T5/Qwen/etc.), not a full image model. These are
 * often shipped alongside sharded models and must not be mistaken for a
 * checkpoint.
 */
function isTextEncoderFile(name: string): boolean {
  return /(text_encoder|text-encoder|clip|t5|qwen|llm|language_model|text_enc)/i.test(name)
}

/**
 * Pick the single-file checkpoint to download from a model's file list.
 *
 * HF repos don't follow a naming convention, so we can't guess the filename
 * from the repo id (e.g. `stabilityai/sd-turbo` ships `sd_turbo.safetensors`,
 * not `sd-turbo.safetensors`). This selects the best root-level checkpoint:
 *
 *   - Only root-level `.safetensors` / `.ckpt` files.
 *   - Excludes shards (`_1`, `_2`, …) and text encoders (CLIP/T5/Qwen).
 *   - Prefer the non-fp16 variant (smaller, and ComfyUI loads fp32/fp16 fine).
 *   - Fall back to the smallest remaining checkpoint when only fp16 exists.
 *
 * Returns the `rfilename`, or null when the repo has no single-file checkpoint
 * (e.g. a diffusers-only repo, or a sharded/collection repo).
 */
export function pickCheckpointFile(siblings: HfModelFile[]): string | null {
  const allNames = siblings.map(s => s.rfilename)
  const checkpoints = siblings
    .filter(s => !s.rfilename.includes('/'))
    .filter(s => /\.(safetensors|ckpt)$/i.test(s.rfilename))
    .filter(s => !isShardFile(s.rfilename, allNames))
    .filter(s => !isTextEncoderFile(s.rfilename))

  if (checkpoints.length === 0) return null

  const nonFp16 = checkpoints.filter(s => !/fp16/i.test(s.rfilename))
  const pool = nonFp16.length > 0 ? nonFp16 : checkpoints

  // Prefer the smallest (fp32 single-file checkpoints are usually the "main" one).
  const sorted = [...pool].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
  return sorted[0]?.rfilename ?? null
}

/**
 * The folder name a diffusers repo should be downloaded into. ComfyUI's
 * `DiffusersLoader` expects a subfolder of `models/diffusers/` containing a
 * `model_index.json`, so we use the repo's short name (last path segment).
 */
export function diffusersFolderName(modelId: string): string {
  return modelId.split('/').pop() || modelId
}

/**
 * Files to download for a diffusers-format repo. Downloads every model file
 * (unet/, vae/, text_encoder/, tokenizer/, scheduler/, model_index.json, and
 * root config.json) while skipping non-model files (README, LICENSE, images,
 * .gitattributes). The full folder structure is preserved so ComfyUI's
 * DiffusersLoader can load it.
 */
export function pickDiffusersFiles(siblings: HfModelFile[]): string[] {
  const SKIP = /(^|\/)(\.gitattributes|README\.md|LICENSE(\.md)?|.*\.(png|jpg|jpeg|gif|webp|svg))$/i
  return siblings
    .map(s => s.rfilename)
    .filter(f => !SKIP.test(f))
}

/**
 * The files to download for a split-format model, mapped to their ComfyUI
 * target folders. A split model ships the UNet, text encoder, and VAE as
 * separate files under `diffusion_models/`, `text_encoders/`, and `vae/`.
 *
 * Returns `{ rfilename, targetFolder }` pairs. The `diffusion_models/` and
 * `text_encoders/` prefixes are stripped (ComfyUI's UNETLoader/CLIPLoader
 * expect bare filenames); the `vae/` prefix is stripped too (VAELoader expects
 * a bare filename).
 */
export interface SplitModelFile {
  rfilename: string
  targetFolder: 'diffusion_models' | 'text_encoders' | 'vae'
}

export function pickSplitFiles(siblings: HfModelFile[]): SplitModelFile[] {
  const out: SplitModelFile[] = []
  for (const s of siblings) {
    const f = s.rfilename
    if (/^diffusion_models\//i.test(f) && /\.(safetensors|ckpt|gguf)$/i.test(f)) {
      out.push({ rfilename: f, targetFolder: 'diffusion_models' })
    } else if (/^text_encoders\//i.test(f) && /\.(safetensors|ckpt|gguf)$/i.test(f)) {
      out.push({ rfilename: f, targetFolder: 'text_encoders' })
    } else if (/^vae\//i.test(f) && /\.(safetensors|ckpt|gguf)$/i.test(f)) {
      out.push({ rfilename: f, targetFolder: 'vae' })
    }
  }
  return out
}
