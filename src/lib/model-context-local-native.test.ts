import { describe, expect, it } from 'vitest'
import { buildProfileFromCapacity } from './model-context'

describe('local model capacity — native window trusted for ANY model', () => {
  it('uses the full probed window for a future 9B local model with 256K native', () => {
    // e.g. vaultbox/qwen3.5-uncensored:9b reports 262144 via /api/show
    const profile = buildProfileFromCapacity('vaultbox/qwen3.5-uncensored:9b', 'ollama', 9.7, 262144)
    expect(profile.isCloud).toBe(false)
    expect(profile.maxContext).toBe(262144)
    // 262144 >= 4096*4 → recommended scales with the window, capped at 64K.
    expect(profile.recommendedContext).toBe(65536)
  })

  it('uses the full probed window for an 8B model with 128K native (gemma4)', () => {
    const profile = buildProfileFromCapacity('gemma4:latest', 'ollama', 8, 131072)
    expect(profile.maxContext).toBe(131072)
    expect(profile.recommendedContext).toBe(65536)
  })

  it('handles a hypothetical future local model with a 1M window', () => {
    const profile = buildProfileFromCapacity('future-local:32b', 'ollama', 32, 1048576)
    expect(profile.maxContext).toBe(1048576)
    expect(profile.recommendedContext).toBe(65536) // ceiling holds
  })

  it('keeps the conservative bucket when the native window is unknown', () => {
    // /api/show failed → name-only fallback stays conservative.
    const profile = buildProfileFromCapacity('custom-local-model', 'ollama', null, null)
    expect(profile.recommendedContext).toBe(4096)
    expect(profile.maxContext).toBe(8192)
  })

  it('never recommends more than the native window', () => {
    const profile = buildProfileFromCapacity('tiny-model:1b', 'ollama', 1, 2048)
    expect(profile.recommendedContext).toBeLessThanOrEqual(2048)
    expect(profile.maxContext).toBeLessThanOrEqual(2048)
  })
})
