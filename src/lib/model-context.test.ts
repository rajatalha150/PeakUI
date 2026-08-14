import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearModelCapacityCache,
  getModelCapacityProfile,
  getModelContextRecommendation,
  isCloudModel,
  parseModelParameterSizeB,
  shouldUseCompactToolManifest,
} from './model-context'

describe('model-context', () => {
  describe('parseModelParameterSizeB', () => {
    it('extracts parameter size from common tag formats', () => {
      expect(parseModelParameterSizeB('gemma4:8b')).toBe(8)
      expect(parseModelParameterSizeB('qwen3:4b')).toBe(4)
      expect(parseModelParameterSizeB('llama3.1:70b')).toBe(70)
      expect(parseModelParameterSizeB('phi4-mini')).toBeNull()
    })
  })

  describe('isCloudModel', () => {
    it('detects cloud aliases and openai-compatible provider', () => {
      expect(isCloudModel('gemma4:31b-cloud')).toBe(true)
      expect(isCloudModel('qwen3.5:cloud')).toBe(true)
      expect(isCloudModel('gemma4:8b')).toBe(false)
      expect(isCloudModel('gpt-4', 'openai-compatible')).toBe(true)
    })
  })

  describe('getModelContextRecommendation', () => {
    it('recommends conservative contexts for small local models', () => {
      const rec = getModelContextRecommendation('gemma4:8b')
      expect(rec.defaultContext).toBe(4096)
      expect(rec.maxContext).toBe(8192)
      expect(rec.isCloud).toBe(false)
      expect(rec.parameterSizeB).toBe(8)
    })

    it('recommends very small context for tiny local models', () => {
      const rec = getModelContextRecommendation('qwen3:4b')
      expect(rec.defaultContext).toBe(2048)
      expect(rec.maxContext).toBe(4096)
    })

    it('does not cap cloud models', () => {
      const rec = getModelContextRecommendation('gemma4:31b-cloud')
      expect(rec.isCloud).toBe(true)
      expect(rec.defaultContext).toBe(16384)
      expect(rec.maxContext).toBe(131072)
    })

    it('treats openai-compatible models as cloud', () => {
      const rec = getModelContextRecommendation('gpt-4o', 'openai-compatible')
      expect(rec.isCloud).toBe(true)
      expect(rec.maxContext).toBe(131072)
    })

    it('falls back to conservative defaults for unknown local models', () => {
      const rec = getModelContextRecommendation('custom-local-model')
      expect(rec.isCloud).toBe(false)
      expect(rec.defaultContext).toBe(4096)
      expect(rec.maxContext).toBe(8192)
    })
  })

  describe('shouldUseCompactToolManifest', () => {
    it('uses compact prompts for small local models', () => {
      expect(shouldUseCompactToolManifest('gemma4:latest')).toBe(true)
      expect(shouldUseCompactToolManifest('qwen3:4b')).toBe(true)
      expect(shouldUseCompactToolManifest('llama3.1:8b')).toBe(true)
    })

    it('keeps full prompts for larger local models and cloud models', () => {
      expect(shouldUseCompactToolManifest('llama3.1:70b')).toBe(false)
      expect(shouldUseCompactToolManifest('gemma4:31b-cloud')).toBe(false)
      expect(shouldUseCompactToolManifest('gpt-4o', 'openai-compatible')).toBe(false)
    })
  })

  describe('getModelCapacityProfile', () => {
    beforeEach(() => {
      clearModelCapacityCache()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function stubShowResponse(data: unknown) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => data,
      }))
    }

    it('parses the older /api/show format (details.parameter_size + model_info.context_length)', async () => {
      stubShowResponse({
        details: { parameter_size: '8.0B' },
        model_info: { 'gemma4.context_length': 131072 },
      })
      const profile = await getModelCapacityProfile('gemma4', 'ollama', 'http://127.0.0.1:11434')
      expect(profile.parameterSizeB).toBe(8)
      expect(profile.nativeContextLength).toBe(131072)
      expect(profile.promptTier).toBe('compact')
      // Native window ≥ 8192 raises the ≤9B default from 4096 to 8192.
      expect(profile.recommendedContext).toBe(8192)
      expect(profile.maxContext).toBe(8192)
    })

    it('parses the newer /api/show format (general.parameter_count + general.context_length)', async () => {
      stubShowResponse({
        general: { parameter_count: 8e9, context_length: 131072 },
      })
      const profile = await getModelCapacityProfile('gemma4', 'ollama', 'http://127.0.0.1:11434')
      expect(profile.parameterSizeB).toBe(8)
      expect(profile.nativeContextLength).toBe(131072)
      expect(profile.promptTier).toBe('compact')
      expect(profile.recommendedContext).toBe(8192)
    })

    it('clamps the recommendation to a small native window', async () => {
      stubShowResponse({
        general: { parameter_count: 8e9, context_length: 4096 },
      })
      const profile = await getModelCapacityProfile('gemma4', 'ollama', 'http://127.0.0.1:11434')
      expect(profile.recommendedContext).toBe(4096)
      expect(profile.maxContext).toBe(4096)
    })

    it('raises the ≤4B default when the native window allows', async () => {
      stubShowResponse({
        general: { parameter_count: 3e9, context_length: 8192 },
      })
      const profile = await getModelCapacityProfile('qwen3', 'ollama', 'http://127.0.0.1:11434')
      expect(profile.promptTier).toBe('minimal')
      expect(profile.recommendedContext).toBe(4096)
    })

    it('falls back to name detection when /api/show fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ollama down')))
      const profile = await getModelCapacityProfile('gemma4:8b', 'ollama', 'http://127.0.0.1:11434')
      expect(profile.promptTier).toBe('compact')
      expect(profile.recommendedContext).toBe(4096)
      expect(profile.nativeContextLength).toBeNull()
    })

    it('treats unknown local models conservatively on fetch failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ollama down')))
      const profile = await getModelCapacityProfile('custom-local-model', 'ollama', 'http://127.0.0.1:11434')
      expect(profile.promptTier).toBe('compact')
      expect(profile.recommendedContext).toBe(4096)
    })

    it('returns the cloud profile for non-Ollama providers without fetching', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const profile = await getModelCapacityProfile('gpt-4o', 'openai-compatible')
      expect(profile.isCloud).toBe(true)
      expect(profile.promptTier).toBe('full')
      expect(profile.recommendedContext).toBe(16384)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('caches the /api/show result per model', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ general: { parameter_count: 8e9, context_length: 131072 } }),
      })
      vi.stubGlobal('fetch', fetchMock)
      await getModelCapacityProfile('gemma4', 'ollama', 'http://127.0.0.1:11434')
      await getModelCapacityProfile('gemma4', 'ollama', 'http://127.0.0.1:11434')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
