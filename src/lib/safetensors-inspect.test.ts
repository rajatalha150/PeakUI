import { describe, expect, it } from 'vitest'
import { classifyTensors } from './safetensors-inspect'

describe('classifyTensors', () => {
  it('classifies a full checkpoint (UNet + CLIP + VAE)', () => {
    const keys = [
      'model.diffusion_model.input_blocks.0.weight',
      'cond_stage_model.transformer.text_model.weight',
      'first_stage_model.encoder.conv_in.weight',
    ]
    const r = classifyTensors(keys)
    expect(r.kind).toBe('full-checkpoint')
    expect(r.hasUnetTensors).toBe(true)
    expect(r.hasTextEncoderTensors).toBe(true)
    expect(r.hasVaeTensors).toBe(true)
  })

  it('classifies a UNet-only (DiT) file — like anima/z-image', () => {
    const keys = [
      'net.blocks.10.cross_attn.k_proj.weight',
      'net.blocks.10.cross_attn.k_proj.input_scale',
      'net.blocks.20.final_layer.weight',
    ]
    const result = classifyTensors(keys)
    expect(result.kind).toBe('unet-only')
    expect(result.hasUnetTensors).toBe(true)
    expect(result.hasTextEncoderTensors).toBe(false)
    expect(result.hasVaeTensors).toBe(false)
  })

  it('classifies a text-encoder file', () => {
    const keys = ['text_encoder.model.weight', 'text_encoder.model.layers.0.weight']
    expect(classifyTensors(keys).kind).toBe('text-encoder')
  })

  it('classifies a VAE file', () => {
    const keys = ['first_stage_model.encoder.conv.weight', 'first_stage_model.decoder.conv.weight']
    expect(classifyTensors(keys).kind).toBe('vae')
  })

  it('treats UNet + VAE without text encoder as unet-only (incomplete)', () => {
    const keys = [
      'model.diffusion_model.input_blocks.weight',
      'first_stage_model.encoder.conv.weight',
    ]
    expect(classifyTensors(keys).kind).toBe('unet-only')
  })

  it('ignores __metadata__', () => {
    const keys = ['__metadata__', 'unet.blocks.0.weight']
    expect(classifyTensors(keys).kind).toBe('unet-only')
  })
})