import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  normalizeAppSettings,
  normalizeWorkspaceToolFavoriteModels,
} from './settings'

describe('normalizeWorkspaceToolFavoriteModels', () => {
  it('parses a JSON-encoded string array', () => {
    expect(normalizeWorkspaceToolFavoriteModels('["ollama:llama3.2:3b","openai-compatible:gpt-4o"]'))
      .toEqual(['ollama:llama3.2:3b', 'openai-compatible:gpt-4o'])
  })

  it('accepts a raw array', () => {
    expect(normalizeWorkspaceToolFavoriteModels(['ollama:qwen2.5:7b']))
      .toEqual(['ollama:qwen2.5:7b'])
  })

  it('returns [] for an empty / blank / malformed string', () => {
    expect(normalizeWorkspaceToolFavoriteModels('')).toEqual([])
    expect(normalizeWorkspaceToolFavoriteModels('   ')).toEqual([])
    expect(normalizeWorkspaceToolFavoriteModels('not json')).toEqual([])
    expect(normalizeWorkspaceToolFavoriteModels('[]')).toEqual([])
  })

  it('returns [] for non-array / non-string input', () => {
    expect(normalizeWorkspaceToolFavoriteModels(null)).toEqual([])
    expect(normalizeWorkspaceToolFavoriteModels({})).toEqual([])
    expect(normalizeWorkspaceToolFavoriteModels(42)).toEqual([])
    expect(normalizeWorkspaceToolFavoriteModels(undefined)).toEqual([])
  })

  it('drops non-string entries and trims / de-duplicates', () => {
    expect(normalizeWorkspaceToolFavoriteModels(['ollama:a', ' ollama:a ', 'ollama:b', 7, null, '']))
      .toEqual(['ollama:a', 'ollama:b'])
  })

  it('strips control characters from keys', () => {
    const out = normalizeWorkspaceToolFavoriteModels(['ollama:a\nb', 'ollama:c\td'])
    // Newlines/tabs are control chars and are removed — the key collapses,
    // so 'ollama:ab' and 'ollama:cd' (no internal whitespace gaps).
    expect(out).toEqual(['ollama:ab', 'ollama:cd'])
  })

  it('caps the total number of favorites', () => {
    const many = Array.from({ length: 500 }, (_, i) => `ollama:model${i}`)
    const out = normalizeWorkspaceToolFavoriteModels(many)
    expect(out.length).toBe(256)
  })

  it('caps the length of a single key', () => {
    const long = 'x'.repeat(500)
    const out = normalizeWorkspaceToolFavoriteModels([long])
    expect(out[0].length).toBe(200)
  })

  it('never returns the input array by reference', () => {
    const input = ['ollama:a']
    const out = normalizeWorkspaceToolFavoriteModels(input)
    expect(out).not.toBe(input)
    expect(out).toEqual(input)
  })
})

describe('normalizeAppSettings — workspaceToolFavoriteModels round-trip', () => {
  it('stores favorites as a JSON string (DB column shape), not an array', () => {
    const out = normalizeAppSettings({ workspaceToolFavoriteModels: '["ollama:llama3.2:3b"]' })
    expect(typeof out.workspaceToolFavoriteModels).toBe('string')
    expect(out.workspaceToolFavoriteModels).toBe('["ollama:llama3.2:3b"]')
  })

  it('defaults to the empty JSON array string when absent', () => {
    const out = normalizeAppSettings({})
    expect(out.workspaceToolFavoriteModels).toBe('[]')
    expect(DEFAULT_SETTINGS.workspaceToolFavoriteModels).toBe('[]')
  })

  it('normalizes a malformed stored value back to "[]"', () => {
    expect(normalizeAppSettings({ workspaceToolFavoriteModels: 'garbage' }).workspaceToolFavoriteModels).toBe('[]')
    expect(normalizeAppSettings({ workspaceToolFavoriteModels: null }).workspaceToolFavoriteModels).toBe('[]')
  })

  it('de-duplicates on the way through', () => {
    const out = normalizeAppSettings({ workspaceToolFavoriteModels: '["ollama:a","ollama:a","ollama:b"]' })
    expect(JSON.parse(out.workspaceToolFavoriteModels)).toEqual(['ollama:a', 'ollama:b'])
  })
})