import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureOllamaModelLoaded } from './ollama-control'

describe('ensureOllamaModelLoaded', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns alreadyLoaded when the model is resident (name matching strips :latest)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'hf.co/Foo-Bar:latest' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ensureOllamaModelLoaded('http://ollama:11434', 'hf.co/Foo-Bar', { keepAlive: '30m' })

    expect(result).toEqual({ model: 'hf.co/Foo-Bar', loaded: true, alreadyLoaded: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads a missing model with an empty-prompt warmup pinned to keep_alive', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'gemma4' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ensureOllamaModelLoaded('http://ollama:11434', 'nemotron', { keepAlive: '30m' })

    expect(result).toEqual({ model: 'nemotron', loaded: true, alreadyLoaded: false })
    const [warmupUrl, warmupInit] = fetchMock.mock.calls[1]
    expect(warmupUrl).toBe('http://ollama:11434/api/generate')
    expect(JSON.parse(warmupInit.body)).toEqual({
      model: 'nemotron',
      prompt: '',
      keep_alive: '30m',
      stream: false,
    })
  })

  it('throws when the load request fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'model load boom',
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureOllamaModelLoaded('http://ollama:11434', 'nemotron', { keepAlive: '30m' }))
      .rejects.toThrow('model load boom')
  })
})
