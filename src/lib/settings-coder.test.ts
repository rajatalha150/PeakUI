import { describe, expect, it } from 'vitest'
import {
  CODER_APPROVAL_MODES,
  DEFAULT_SETTINGS,
  normalizeAppSettings,
  normalizeCoderApprovalMode,
  normalizeCoderContextLength,
  normalizeCoderToolSearchThreshold,
  normalizeCoderWorkspace,
} from './settings'

/**
 * The coder settings are the difference between "the Coding surface remembers
 * my model and lets the agent act" and "every reload silently resets to the
 * daemon default". These cover the sentinel handling (0 = "leave it alone"),
 * the enum clamp, and the cwd canonicalisation the daemon keys workspaces by.
 */
describe('normalizeCoderApprovalMode', () => {
  it('accepts the two modes the Coding surface exposes', () => {
    for (const mode of CODER_APPROVAL_MODES) {
      expect(normalizeCoderApprovalMode(mode)).toBe(mode)
    }
    expect(CODER_APPROVAL_MODES).toEqual(['auto', 'yolo'])
  })

  it('normalizes the legacy restrictive modes down to the default (yolo)', () => {
    // plan / default / auto-edit used to be offered; they gate ordinary tool
    // use, so they are no longer selectable and must not leak back in.
    for (const legacy of ['plan', 'default', 'auto-edit']) {
      expect(normalizeCoderApprovalMode(legacy)).toBe(DEFAULT_SETTINGS.coderApprovalMode)
    }
  })

  it('falls back to the default for unknown / non-string input', () => {
    for (const bad of ['nope', '', null, undefined, 42, {}, []]) {
      expect(normalizeCoderApprovalMode(bad)).toBe(DEFAULT_SETTINGS.coderApprovalMode)
    }
  })

  it('defaults to yolo so the isolated agent acts without tool prompts', () => {
    expect(DEFAULT_SETTINGS.coderApprovalMode).toBe('yolo')
  })
})

describe('normalizeCoderContextLength', () => {
  it('treats 0 and invalid values as the "leave it alone" sentinel', () => {
    for (const v of [0, -1, '', null, undefined, NaN, 'abc']) {
      expect(normalizeCoderContextLength(v)).toBe(0)
    }
  })

  it('clamps to the same bounds as the WorkSpaces context slider and steps by 512', () => {
    expect(normalizeCoderContextLength(100_000_000)).toBe(131072)
    expect(normalizeCoderContextLength(1)).toBe(512)
    // 5000 is 9.77 steps of 512, so it lands on the nearest step (10 -> 5120).
    expect(normalizeCoderContextLength(5000)).toBe(5120)
  })
})

describe('normalizeCoderToolSearchThreshold', () => {
  it('treats 0 and invalid values as "use the daemon default"', () => {
    for (const v of [0, -5, '', null, undefined, NaN]) {
      expect(normalizeCoderToolSearchThreshold(v)).toBe(0)
    }
  })

  it('caps at 100 because the value is a percent of the context window', () => {
    // Beyond 100 the whole window would be spent on schemas; the daemon clamps
    // there too, so a typo like 1000 must not reach it unclamped.
    expect(normalizeCoderToolSearchThreshold(1000)).toBe(100)
    expect(normalizeCoderToolSearchThreshold(100)).toBe(100)
    expect(normalizeCoderToolSearchThreshold(75.6)).toBe(76)
  })
})

describe('normalizeCoderWorkspace', () => {
  it('keeps an absolute path and strips a trailing slash', () => {
    expect(normalizeCoderWorkspace('/workspace')).toBe('/workspace')
    expect(normalizeCoderWorkspace('/srv/app/')).toBe('/srv/app')
    expect(normalizeCoderWorkspace('  /srv/app  ')).toBe('/srv/app')
  })

  it('falls back to the default for relative or empty paths', () => {
    // A relative cwd would resolve inside the daemon's own install dir.
    for (const bad of ['workspace', '', '   ', null, undefined, 42, './rel']) {
      expect(normalizeCoderWorkspace(bad)).toBe(DEFAULT_SETTINGS.coderWorkspace)
    }
  })

  it('keeps the root path intact', () => {
    expect(normalizeCoderWorkspace('/')).toBe('/')
  })
})

describe('normalizeAppSettings coder fields', () => {
  it('supplies defaults when the row predates the coder columns', () => {
    const s = normalizeAppSettings({})
    expect(s.coderModel).toBe('')
    expect(s.coderBaseUrl).toBe('')
    expect(s.coderApiKey).toBe('')
    expect(s.coderApprovalMode).toBe('yolo')
    expect(s.coderContextLength).toBe(0)
    expect(s.coderToolSearchThreshold).toBe(0)
    expect(s.coderWorkspace).toBe('/workspace')
    expect(s.coderToolsEnabled).toBe(true)
  })

  it('round-trips saved values', () => {
    const s = normalizeAppSettings({
      coderModel: '  deepseek-v4.1-flash:cloud  ',
      coderBaseUrl: 'http://127.0.0.1:11434/v1',
      coderApprovalMode: 'yolo',
      coderContextLength: 8192,
      coderToolSearchThreshold: 100,
      coderWorkspace: '/srv/app/',
      coderToolsEnabled: false,
    })
    expect(s.coderModel).toBe('deepseek-v4.1-flash:cloud')
    expect(s.coderApprovalMode).toBe('yolo')
    expect(s.coderContextLength).toBe(8192)
    expect(s.coderToolSearchThreshold).toBe(100)
    expect(s.coderWorkspace).toBe('/srv/app')
    expect(s.coderToolsEnabled).toBe(false)
  })
})
