import { describe, expect, it } from 'vitest'
import { pickCheckpointFile, comfyFolderForHfFile, hfResolveUrl } from './hf-client'

describe('pickCheckpointFile', () => {
  it('picks the root-level safetensors checkpoint (not a guessed name)', () => {
    const siblings = [
      { rfilename: 'sd_turbo.safetensors', size: 1_400_000_000 },
      { rfilename: 'text_encoder/model.safetensors', size: 100 },
      { rfilename: 'unet/diffusion_pytorch_model.safetensors', size: 200 },
    ]
    expect(pickCheckpointFile(siblings)).toBe('sd_turbo.safetensors')
  })

  it('prefers the non-fp16 variant when both exist', () => {
    const siblings = [
      { rfilename: 'sd_xl_turbo_1.0.safetensors', size: 6_900_000_000 },
      { rfilename: 'sd_xl_turbo_1.0_fp16.safetensors', size: 13_900_000_000 },
    ]
    expect(pickCheckpointFile(siblings)).toBe('sd_xl_turbo_1.0.safetensors')
  })

  it('falls back to fp16 when it is the only checkpoint', () => {
    const siblings = [{ rfilename: 'model_fp16.safetensors', size: 5_000_000_000 }]
    expect(pickCheckpointFile(siblings)).toBe('model_fp16.safetensors')
  })

  it('returns null for a diffusers-only repo (no root checkpoint)', () => {
    const siblings = [
      { rfilename: 'unet/diffusion_pytorch_model.safetensors', size: 200 },
      { rfilename: 'vae/diffusion_pytorch_model.safetensors', size: 100 },
    ]
    expect(pickCheckpointFile(siblings)).toBeNull()
  })

  it('accepts .ckpt checkpoints too', () => {
    const siblings = [{ rfilename: 'dreamshaper_7.ckpt', size: 2_000_000_000 }]
    expect(pickCheckpointFile(siblings)).toBe('dreamshaper_7.ckpt')
  })
})

describe('comfyFolderForHfFile', () => {
  it('maps root checkpoints to checkpoints', () => {
    expect(comfyFolderForHfFile('sd_turbo.safetensors')).toBe('checkpoints')
  })
  it('maps unet/ to diffusion_models', () => {
    expect(comfyFolderForHfFile('unet/model.safetensors')).toBe('diffusion_models')
  })
  it('maps vae/ to vae', () => {
    expect(comfyFolderForHfFile('vae/model.safetensors')).toBe('vae')
  })
  it('maps text_encoder/ to text_encoders', () => {
    expect(comfyFolderForHfFile('text_encoder/model.safetensors')).toBe('text_encoders')
  })
})

describe('hfResolveUrl', () => {
  it('builds the resolve URL', () => {
    expect(hfResolveUrl('stabilityai/sd-turbo', 'sd_turbo.safetensors'))
      .toBe('https://huggingface.co/stabilityai/sd-turbo/resolve/main/sd_turbo.safetensors')
  })
})
