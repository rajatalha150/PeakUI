import { describe, expect, it } from 'vitest'
import { buildProfileFromCapacity, isCloudModel } from './model-context'
import { isRetryableModelStreamError } from './workspace-agent-run'

describe('cloud model capacity (kimi-k3 fix)', () => {
  it('treats :cloud models as cloud', () => {
    expect(isCloudModel('kimi-k3:cloud')).toBe(true)
    expect(isCloudModel('deepseek-v4-pro:cloud')).toBe(true)
    expect(isCloudModel('llama3.2:3b')).toBe(false)
  })

  it('uses the native context window reported by /api/show for cloud models', () => {
    // kimi-k3:cloud reports kimi-k3.context_length = 1048576
    const profile = buildProfileFromCapacity('kimi-k3:cloud', 'ollama', 2812, 1048576)
    expect(profile.isCloud).toBe(true)
    expect(profile.recommendedContext).toBe(1048576)
    expect(profile.maxContext).toBe(1048576)
    expect(profile.promptTier).toBe('full')
  })

  it('falls back to conservative defaults when the cloud window is unknown', () => {
    const profile = buildProfileFromCapacity('some-model:cloud', 'ollama', null, null)
    expect(profile.isCloud).toBe(true)
    expect(profile.recommendedContext).toBe(16384)
    expect(profile.maxContext).toBe(131072)
  })
})

describe('transient model-round error detection', () => {
  it('recognizes ollama.com mid-stream 500 ref errors', () => {
    expect(isRetryableModelStreamError('Internal Server Error (ref: 3bc2059e-842c-44e8-9d76-faf628de1393)')).toBe(true)
  })

  it('recognizes network flaps', () => {
    expect(isRetryableModelStreamError('fetch failed: ECONNRESET')).toBe(true)
    expect(isRetryableModelStreamError('TypeError: fetch failed')).toBe(true)
  })

  it('does NOT retry deterministic failures', () => {
    expect(isRetryableModelStreamError('PDF content is required. Provide prose, sections, fields, tables, or callouts.')).toBe(false)
    expect(isRetryableModelStreamError('Unauthorized')).toBe(false)
    expect(isRetryableModelStreamError('Model request failed with HTTP 400.')).toBe(false)
  })
})
