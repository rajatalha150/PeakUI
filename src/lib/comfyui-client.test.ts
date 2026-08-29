import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  comfyUiViewUrl,
  getComfyUiHistory,
  getComfyUiSystemStats,
  listComfyUiFolders,
  listComfyUiModels,
  submitComfyUiTxt2Img,
} from './comfyui-client'

describe('comfyui-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports offline when the engine is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const stats = await getComfyUiSystemStats('http://127.0.0.1:8188')
    expect(stats.online).toBe(false)
    expect(stats.error).toContain('ECONNREFUSED')
  })

  it('parses system stats (GPU name + VRAM)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 3060', vram_total: 12_500_000_000, vram_free: 8_000_000_000 }] }),
    }))
    const stats = await getComfyUiSystemStats('http://127.0.0.1:8188')
    expect(stats.online).toBe(true)
    expect(stats.gpuName).toContain('RTX 3060')
    expect(stats.vramTotalBytes).toBe(12_500_000_000)
  })

  it('lists model folders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['checkpoints', 'diffusion_models', 'loras'],
    }))
    const result = await listComfyUiFolders('http://127.0.0.1:8188')
    expect(result.online).toBe(true)
    expect(result.folders).toContain('checkpoints')
  })

  it('lists models in a folder', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'sd_xl_turbo_1.0.safetensors', pathIndex: 0 }],
    }))
    const result = await listComfyUiModels('http://127.0.0.1:8188', 'checkpoints')
    expect(result.online).toBe(true)
    expect(result.models[0].name).toBe('sd_xl_turbo_1.0.safetensors')
  })

  it('normalizes a plain string-array model list (ComfyUI returns filenames, not objects)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['sd_turbo.safetensors'],
    }))
    const result = await listComfyUiModels('http://127.0.0.1:8188', 'checkpoints')
    expect(result.online).toBe(true)
    expect(result.models).toEqual([{ name: 'sd_turbo.safetensors', pathIndex: 0 }])
  })

  it('submits a txt2img workflow and returns the prompt id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prompt_id: 'abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await submitComfyUiTxt2Img('http://127.0.0.1:8188', {
      model: 'sd_xl_turbo_1.0.safetensors',
      prompt: 'a cat',
    })
    expect(result.online).toBe(true)
    expect(result.promptId).toBe('abc123')
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.prompt['4'].inputs.ckpt_name).toBe('sd_xl_turbo_1.0.safetensors')
    expect(body.prompt['6'].inputs.text).toBe('a cat')
  })

  it('polls history and returns output images when done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ abc123: { outputs: { '9': { images: [{ filename: 'peakui_00001_.png', subfolder: '', type: 'output' }] } } } }),
    }))
    const result = await getComfyUiHistory('http://127.0.0.1:8188', 'abc123')
    expect(result.done).toBe(true)
    expect(result.images?.[0].filename).toBe('peakui_00001_.png')
  })

  it('builds a /view URL for a generated image', () => {
    const url = comfyUiViewUrl('http://127.0.0.1:8188', { filename: 'x.png', subfolder: '', type: 'output' })
    expect(url).toContain('/view?')
    expect(url).toContain('filename=x.png')
  })
})
