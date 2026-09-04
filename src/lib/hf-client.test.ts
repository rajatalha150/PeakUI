import { describe, expect, it } from 'vitest'
import { pickCheckpointFile, comfyFolderForHfFile, hfResolveUrl, classifyHfModelKind, diffusersFolderName, pickDiffusersFiles } from './hf-client'

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

  it('skips sharded files (_1, _2) and text encoders', () => {
    const siblings = [
      { rfilename: 'qwen_3_4b_bf16_fp8_scaled.safetensors', size: 4_400_000_000 },
      { rfilename: 'z_image_turbo_bf16_fp8_scaled_1.safetensors', size: 3_000_000_000 },
      { rfilename: 'z_image_turbo_bf16_fp8_scaled_2.safetensors', size: 3_000_000_000 },
    ]
    expect(pickCheckpointFile(siblings)).toBeNull()
  })

  it('still picks a real checkpoint when shards/encoders are also present', () => {
    const siblings = [
      { rfilename: 'text_encoder/model.safetensors', size: 4_400_000_000 },
      { rfilename: 'model_1.safetensors', size: 3_000_000_000 },
      { rfilename: 'model_2.safetensors', size: 3_000_000_000 },
      { rfilename: 'real_checkpoint.safetensors', size: 6_900_000_000 },
    ]
    expect(pickCheckpointFile(siblings)).toBe('real_checkpoint.safetensors')
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

describe('classifyHfModelKind', () => {
  it('classifies a root-level checkpoint as checkpoint', () => {
    expect(classifyHfModelKind([{ rfilename: 'sd_turbo.safetensors' }])).toBe('checkpoint')
  })

  it('classifies a diffusers layout (unet/vae/text_encoder) as diffusers', () => {
    expect(classifyHfModelKind([
      { rfilename: 'unet/diffusion_pytorch_model.safetensors' },
      { rfilename: 'vae/diffusion_pytorch_model.safetensors' },
      { rfilename: 'text_encoder/model.safetensors' },
    ])).toBe('diffusers')
  })

  it('classifies a component collection (loose files, no root checkpoint) as collection', () => {
    expect(classifyHfModelKind([
      { rfilename: 'Flux1/LoRas/navi_flux_v1.safetensors' },
      { rfilename: 'Flux1/clip/clip_l.safetensors' },
      { rfilename: 'Adetailer/face_yolov8m.pt' },
    ])).toBe('collection')
  })

  it('classifies a repo with no model files as unknown', () => {
    expect(classifyHfModelKind([
      { rfilename: 'README.md' },
      { rfilename: 'config.json' },
    ])).toBe('unknown')
  })

  it('classifies a diffusers repo as diffusers even when it has a root .safetensors (UNet-only)', () => {
    // stabilityai/sd-turbo ships sd_turbo.safetensors at root (UNet-only) plus
    // the full diffusers layout. It must be classified as diffusers, not
    // checkpoint, or ComfyUI fails with "clip input is invalid: None".
    expect(classifyHfModelKind([
      { rfilename: 'sd_turbo.safetensors' },
      { rfilename: 'model_index.json' },
      { rfilename: 'unet/diffusion_pytorch_model.safetensors' },
      { rfilename: 'vae/diffusion_pytorch_model.safetensors' },
      { rfilename: 'text_encoder/model.safetensors' },
    ])).toBe('diffusers')
  })
})

describe('diffusersFolderName', () => {
  it('uses the repo short name', () => {
    expect(diffusersFolderName('stabilityai/stable-diffusion-xl-base-1.0')).toBe('stable-diffusion-xl-base-1.0')
  })
})

describe('pickDiffusersFiles', () => {
  it('keeps model files and drops docs/images', () => {
    const files = pickDiffusersFiles([
      { rfilename: 'model_index.json' },
      { rfilename: 'unet/diffusion_pytorch_model.safetensors' },
      { rfilename: 'vae/diffusion_pytorch_model.safetensors' },
      { rfilename: 'text_encoder/model.safetensors' },
      { rfilename: 'README.md' },
      { rfilename: 'LICENSE.md' },
      { rfilename: '01.png' },
      { rfilename: '.gitattributes' },
    ])
    expect(files).toContain('model_index.json')
    expect(files).toContain('unet/diffusion_pytorch_model.safetensors')
    expect(files).toContain('vae/diffusion_pytorch_model.safetensors')
    expect(files).toContain('text_encoder/model.safetensors')
    expect(files).not.toContain('README.md')
    expect(files).not.toContain('LICENSE.md')
    expect(files).not.toContain('01.png')
    expect(files).not.toContain('.gitattributes')
  })

  it('skips the safety checker, .bin twins, and extra root checkpoints (SD1.5 archive case)', () => {
    const files = pickDiffusersFiles([
      'model_index.json', 'feature_extractor/preprocessor_config.json',
      'safety_checker/config.json', 'safety_checker/model.safetensors', 'safety_checker/pytorch_model.bin',
      'scheduler/scheduler_config.json',
      'text_encoder/config.json', 'text_encoder/model.safetensors', 'text_encoder/pytorch_model.bin',
      'tokenizer/merges.txt', 'tokenizer/special_tokens_map.json', 'tokenizer/tokenizer_config.json', 'tokenizer/vocab.json',
      'unet/config.json', 'unet/diffusion_pytorch_model.bin', 'unet/diffusion_pytorch_model.safetensors',
      'v1-5-pruned-emaonly.ckpt', 'v1-5-pruned-emaonly.safetensors', 'v1-5-pruned.ckpt', 'v1-5-pruned.safetensors',
      'v1-inference.yaml',
      'vae/config.json', 'vae/diffusion_pytorch_model.bin', 'vae/diffusion_pytorch_model.safetensors',
    ].map(f => ({ rfilename: f })))
    // Minimal set: 13 files, one root checkpoint, no safety_checker, no .bin twins
    expect(files).toHaveLength(13)
    expect(files).toContain('unet/diffusion_pytorch_model.safetensors')
    expect(files).toContain('v1-5-pruned-emaonly.safetensors')
    expect(files.filter(f => f.startsWith('safety_checker'))).toHaveLength(0)
    expect(files.filter(f => f.endsWith('.bin'))).toHaveLength(0)
    expect(files.filter(f => !f.includes('/') && /\.(safetensors|ckpt)$/i.test(f))).toHaveLength(1)
  })
})
