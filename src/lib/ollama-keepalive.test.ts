import { describe, expect, it } from 'vitest'
import { buildOllamaKeepAlive, isOllamaCloudModel, parseKeepAliveMs } from './ollama-keepalive'

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

describe('parseKeepAliveMs', () => {
  it('parses the preset durations', () => {
    expect(parseKeepAliveMs('5m')).toBe(5 * 60_000)
    expect(parseKeepAliveMs('30m')).toBe(30 * 60_000)
    expect(parseKeepAliveMs('1h')).toBe(60 * 60_000)
    expect(parseKeepAliveMs('2h')).toBe(120 * 60_000)
  })

  it('parses custom Ollama-style durations', () => {
    expect(parseKeepAliveMs('45s')).toBe(45_000)
    expect(parseKeepAliveMs('1500ms')).toBe(1500)
    expect(parseKeepAliveMs('10m')).toBe(600_000)
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(parseKeepAliveMs('  30M ')).toBe(30 * 60_000)
  })

  it('returns 0 for the "0" unload sentinel and invalid values', () => {
    expect(parseKeepAliveMs('0')).toBe(0)
    expect(parseKeepAliveMs('')).toBe(0)
    expect(parseKeepAliveMs('abc')).toBe(0)
    expect(parseKeepAliveMs('30')).toBe(0)
    expect(parseKeepAliveMs('1.5h')).toBe(0)
  })
})
