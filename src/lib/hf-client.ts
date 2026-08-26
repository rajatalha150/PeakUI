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
}

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
  return token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}
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
  params.set('full', 'false')

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
  }>

  return data
    .filter(entry => typeof entry.id === 'string')
    .map(entry => ({
      id: entry.id as string,
      pipelineTag: entry.pipeline_tag,
      downloads: entry.downloads,
      likes: entry.likes,
      libraryName: entry.library_name,
      tags: entry.tags,
    }))
}

export async function getHfModelDetail(modelId: string, token?: string): Promise<HfModelDetail> {
  const response = await fetch(`${HF_API_BASE}/models/${encodeURIComponent(modelId)}`, {
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
