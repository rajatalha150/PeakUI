import { describe, expect, it } from 'vitest'
import { buildOllamaKeepAlive, isOllamaCloudModel } from './ollama-keepalive'

const baseSettings = {
  modelKeepAlive: true,
  ollamaKeepAlive: '30m',
  ollamaUseCloudApi: false,
}

describe('isOllamaCloudModel', () => {
  it('matches the :cloud suffix case-insensitively', () => {
    expect(isOllamaCloudModel('nemotron:cloud')).toBe(true)
    expect(isOllamaCloudModel('nemotron:CLOUD')).toBe(true)
    expect(isOllamaCloudModel('  gemma:cloud ')).toBe(true)
  })

  it('does not match local or HF-hosted model names', () => {
    expect(isOllamaCloudModel('gemma4')).toBe(false)
    expect(isOllamaCloudModel('hf.co/DavidAU/Qwen3.5-9B-GGUF:latest')).toBe(false)
    expect(isOllamaCloudModel('nemotron')).toBe(false)
  })
})

describe('buildOllamaKeepAlive', () => {
  it('returns the configured duration for a local model when the feature is on', () => {
    expect(buildOllamaKeepAlive(baseSettings, 'gemma4')).toBe('30m')
  })

  it('returns the duration for HF-hosted GGUF models running through local Ollama', () => {
    expect(buildOllamaKeepAlive(baseSettings, 'hf.co/DavidAU/Qwen3.5-9B-GGUF:latest')).toBe('30m')
  })

  it('returns undefined when the keep-alive feature is disabled', () => {
    expect(buildOllamaKeepAlive({ ...baseSettings, modelKeepAlive: false }, 'gemma4')).toBeUndefined()
  })

  it('returns undefined when the Ollama Cloud API is in use', () => {
    expect(buildOllamaKeepAlive({ ...baseSettings, ollamaUseCloudApi: true }, 'gemma4')).toBeUndefined()
  })

  it('returns undefined for :cloud model aliases even on local Ollama', () => {
    expect(buildOllamaKeepAlive(baseSettings, 'nemotron:cloud')).toBeUndefined()
  })

  it('returns undefined for a "0" duration (keep_alive 0 means unload)', () => {
    expect(buildOllamaKeepAlive({ ...baseSettings, ollamaKeepAlive: '0' }, 'gemma4')).toBeUndefined()
  })
})
