import { describe, expect, it } from 'vitest'
import { getModelContextRecommendation, isCloudModel, parseModelParameterSizeB, shouldUseCompactToolManifest } from './model-context'

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
})
