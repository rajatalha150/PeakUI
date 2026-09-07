/**
 * Safetensors header inspection.
 *
 * A safetensors file stores its tensor names and shapes in a JSON header at
 * the front of the file: an 8-byte little-endian u64 length, followed by the
 * JSON. Reading that header is cheap (a few KB read, no model loading) and
 * reveals the *ground truth* of what a file contains — full checkpoint,
 * UNet-only, text encoder, or VAE — replacing filename heuristics.
 *
 * Key conventions:
 *   - Full checkpoint:  model.diffusion_model.* (UNet) +
 *                       cond_stage_model.*    (text encoder) +
 *                       first_stage_model.*   (VAE)
 *   - UNet/DiT only:    model.diffusion_model.* / net.* / layers.* etc. (no cond_stage, no first_stage)
 *   - Text encoder:     cond_stage_model.* / text_encoder.* / te.*
 *   - VAE:              first_stage_model.* / vae.*
 */

import { promises as fs } from 'node:fs'

export type SafetensorsKind = 'full-checkpoint' | 'unet-only' | 'text-encoder' | 'vae' | 'unknown'

export interface SafetensorsInspection {
  tensorCount: number
  /** ~5-10% sample of tensor names (bounded), for classification. */
  sampledKeys: string[]
  hasUnetTensors: boolean
  hasTextEncoderTensors: boolean
  hasVaeTensors: boolean
  kind: SafetensorsKind
  totalBytes?: number
}

const HEADER_SAMPLE_LIMIT = 4000
/** Max header bytes we'll read (some models have megabyte-scale metadata). */
const MAX_HEADER_BYTES = 16 * 1024 * 1024

const UNET_PATTERNS = [
  /^model\.diffusion_model\./,
  /^model\.model\.diffusion_model\./,
  /^net\./,
  /^unet\./,
  /^diffusion_model\./,
  /^model\.model\./,
]

const TEXT_ENCODER_PATTERNS = [
  /^cond_stage_model\./,
  /^text_encoder/,
  /^conditioner\./,
  /^te\./,
  /(^|\.)(t5xxl|clip_l|clip_g|qwen|gemma|llama|mistral)/i,
]

const VAE_PATTERNS = [
  /^first_stage_model\./,
  /^vae\./,
  /^decoder\./,
  /^encoder\./,
]

/**
 * Classify from a list of tensor keys. Exported for testing.
 */
export function classifyTensors(keys: string[]): { kind: SafetensorsKind; hasUnetTensors: boolean; hasTextEncoderTensors: boolean; hasVaeTensors: boolean } {
  const hasUnetTensors = keys.some(k => UNET_PATTERNS.some(p => p.test(k)))
  const hasTextEncoderTensors = keys.some(k => TEXT_ENCODER_PATTERNS.some(p => p.test(k)))
  const hasVaeTensors = keys.some(k => VAE_PATTERNS.some(p => p.test(k)))

  let kind: SafetensorsKind
  if (hasUnetTensors && hasTextEncoderTensors && hasVaeTensors) {
    kind = 'full-checkpoint'
  } else if (hasUnetTensors && !hasTextEncoderTensors && !hasVaeTensors) {
    kind = 'unet-only'
  } else if (!hasUnetTensors && hasTextEncoderTensors && !hasVaeTensors) {
    kind = 'text-encoder'
  } else if (!hasUnetTensors && !hasTextEncoderTensors && hasVaeTensors) {
    kind = 'vae'
  } else {
    // Mixed/partial layouts (e.g. UNet + VAE without text encoder, or
    // unrecognized key conventions). Treat as UNet-only: it cannot be loaded
    // by CheckpointLoaderSimple as a complete model.
    kind = 'unet-only'
  }

  return { kind, hasUnetTensors, hasTextEncoderTensors, hasVaeTensors }
}

/**
 * Inspect a safetensors file's header without loading the model.
 * Only reads the first (8 + headerLength) bytes.
 */
export async function inspectSafetensorsFile(filePath: string): Promise<SafetensorsInspection> {
  const stat = await fs.stat(filePath)
  const fd = await fs.open(filePath, 'r')
  try {
    const lenBuf = Buffer.alloc(8)
    await fd.read(lenBuf, 0, 8, 0)
    const headerLength = Number(lenBuf.readBigUInt64LE(0))

    if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
      throw new Error(`Invalid safetensors header length: ${headerLength}`)
    }

    const headerBuf = Buffer.alloc(Math.min(headerLength, MAX_HEADER_BYTES))
    await fd.read(headerBuf, 0, headerBuf.length, 8)
    const header = JSON.parse(headerBuf.toString('utf8')) as Record<string, unknown>

    // The header maps tensor-name -> {dtype, shape, ...}; `__metadata__` is not a tensor.
    const tensorKeys = Object.keys(header).filter(k => k !== '__metadata__')
    const sampledKeys = tensorKeys.length > HEADER_SAMPLE_LIMIT
      ? tensorKeys.filter((_, i) => i % Math.ceil(tensorKeys.length / HEADER_SAMPLE_LIMIT) === 0)
      : tensorKeys

    const result = classifyTensors(tensorKeys)

    return {
      tensorCount: tensorKeys.length,
      sampledKeys: result.kind === 'unet-only' || result.kind === 'unknown' ? sampledKeys.slice(0, 40) : [],
      ...result,
      totalBytes: stat.size,
    }
  } finally {
    await fd.close()
  }
}