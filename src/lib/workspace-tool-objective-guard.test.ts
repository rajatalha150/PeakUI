import { describe, expect, it } from 'vitest'
import {
  buildForcedSynthesisNudge,
  buildObjectiveAnchorMessage,
  buildObjectiveDivergenceNudge,
  extractObjectiveKeywords,
  extractSearchSignal,
  isSearchRequestRelevantToObjective,
} from './workspace-tool-objective-guard'
import type { WorkspaceToolRequest } from './workspace-tool-tools'

function web(query: string): WorkspaceToolRequest {
  return { name: 'web', request: { query } }
}

function ubSearch(query: string): WorkspaceToolRequest {
  return { name: 'unified_browser', request: { action: 'search', query, browserMode: 'direct' } }
}

function ubOpen(url: string): WorkspaceToolRequest {
  return { name: 'unified_browser', request: { action: 'open', url } }
}

describe('extractObjectiveKeywords', () => {
  it('drops stopwords, short tokens, and keeps meaningful words', () => {
    const kw = extractObjectiveKeywords('analyze stock market for best options play')
    expect(kw.has('analyze')).toBe(true)
    expect(kw.has('stock')).toBe(true)
    expect(kw.has('market')).toBe(true)
    expect(kw.has('options')).toBe(true)
    expect(kw.has('play')).toBe(true)
    // "for" and "best" are stopwords here.
    expect(kw.has('for')).toBe(false)
    expect(kw.has('best')).toBe(false)
  })

  it('is case-insensitive and ignores punctuation', () => {
    const kw = extractObjectiveKeywords('Analyze the Stock-Market! Options...')
    expect(kw.has('analyze')).toBe(true)
    expect(kw.has('stock')).toBe(true)
    expect(kw.has('market')).toBe(true)
    expect(kw.has('options')).toBe(true)
  })

  it('returns an empty set for empty input', () => {
    expect(extractObjectiveKeywords('').size).toBe(0)
    expect(extractObjectiveKeywords('   ').size).toBe(0)
  })
})

describe('extractSearchSignal', () => {
  it('extracts the query for web', () => {
    expect(extractSearchSignal(web('latest nvda earnings'))).toEqual({
      signal: 'latest nvda earnings',
      kind: 'web',
    })
  })

  it('extracts the query for unified_browser search', () => {
    expect(extractSearchSignal(ubSearch('pltr forecast'))).toEqual({
      signal: 'pltr forecast',
      kind: 'unified_browser:search',
    })
  })

  it('returns null for unified_browser open (no topic check)', () => {
    expect(extractSearchSignal(ubOpen('https://stockanalysis.com'))).toBeNull()
  })

  it('returns null for non-search tools', () => {
    const shell: WorkspaceToolRequest = { name: 'shell', request: { command: 'ls' } }
    expect(extractSearchSignal(shell)).toBeNull()
  })
})

describe('isSearchRequestRelevantToObjective', () => {
  it('marks an on-topic web search relevant (the real first-search case)', () => {
    const objective = 'analyze stock market for best options play'
    const result = isSearchRequestRelevantToObjective(
      objective,
      web('stock market analysis best options trades July 2026'),
    )
    expect(result.relevant).toBe(true)
    expect(result.signal).toBe('stock market analysis best options trades July 2026')
  })

  it('marks the pivoted off-topic search NOT relevant (the bug case)', () => {
    const objective = 'analyze stock market for best options play'
    const result = isSearchRequestRelevantToObjective(
      objective,
      ubSearch('most commonly used methods bypassing network restrictions accessing blocked websites'),
    )
    expect(result.relevant).toBe(false)
    expect(result.reason).toMatch(/topic pivot|no keywords/i)
  })

  it('allows a legitimate synonym/refinement that still overlaps', () => {
    const objective = 'analyze stock market for best options play'
    const result = isSearchRequestRelevantToObjective(objective, web('options trading strategies greeks'))
    expect(result.relevant).toBe(true) // "options" overlaps
  })

  it('allows a synonym-only refinement with NO literal overlap (the "dig deeper" bug)', () => {
    const objective = 'analyze the stock market for today'
    const result = isSearchRequestRelevantToObjective(
      objective,
      web('S&P 500 intraday trading analysis September 8 2026 technical levels resistance support volume profile'),
    )
    expect(result.relevant).toBe(true) // "S&P 500 / intraday / trading" are stock-market synonyms
  })

  it('still blocks a genuine topic pivot with no synonym overlap', () => {
    const objective = 'analyze the stock market for today'
    const result = isSearchRequestRelevantToObjective(
      objective,
      web('bypassing network restrictions tor'),
    )
    expect(result.relevant).toBe(false)
  })

  it('returns relevant=true when no objective is recorded', () => {
    const result = isSearchRequestRelevantToObjective('', web('anything at all unrelated'))
    expect(result.relevant).toBe(true)
    expect(result.signal).toBeNull()
  })

  it('returns relevant=true for non-search tools (no check applies)', () => {
    const result = isSearchRequestRelevantToObjective('analyze stock market', ubOpen('https://example.com'))
    expect(result.relevant).toBe(true)
    expect(result.signal).toBeNull()
  })
})

describe('buildObjectiveAnchorMessage', () => {
  it('returns empty string for an empty objective', () => {
    expect(buildObjectiveAnchorMessage('')).toBe('')
    expect(buildObjectiveAnchorMessage('   ')).toBe('')
  })

  it('includes the objective verbatim and the do-not-switch-topics rule', () => {
    const msg = buildObjectiveAnchorMessage('analyze stock market for best options play')
    expect(msg).toContain('analyze stock market for best options play')
    expect(msg).toMatch(/do not switch/i)
    expect(msg).toMatch(/refine the search query/i)
  })
})

describe('buildObjectiveDivergenceNudge', () => {
  it('firm wording when a relevant result already exists', () => {
    const text = buildObjectiveDivergenceNudge(
      'analyze stock market for best options play',
      ubSearch('bypassing network restrictions accessing blocked websites'),
      true,
    )
    expect(text).toContain('already returned usable results')
    expect(text).toContain('analyze stock market for best options play')
    expect(text).toContain('bypassing network restrictions accessing blocked websites')
    expect(text).toMatch(/do not.*off-topic|do NOT declare/i)
  })

  it('softer wording when no relevant result exists yet', () => {
    const text = buildObjectiveDivergenceNudge(
      'analyze stock market for best options play',
      web('bypassing network restrictions'),
      false,
    )
    expect(text).toContain('shares no keywords')
    expect(text).toContain('analyze stock market for best options play')
    expect(text).not.toContain('already returned usable results')
  })

  it('never emits an workspace_tool wrapper or angle-bracket placeholders', () => {
    const text = buildObjectiveDivergenceNudge('objective', web('query'), true)
    expect(text).not.toContain('<workspace_tool')
    // No bare template placeholder tokens that the parser would reject.
    expect(text).not.toMatch(/<value>|<https URL>/)
  })
})

describe('buildForcedSynthesisNudge', () => {
  it('tells the model to stop calling tools and answer in plain text', () => {
    const text = buildForcedSynthesisNudge()
    expect(text).toMatch(/stop calling tools/i)
    expect(text).toMatch(/plain text/i)
    expect(text).toMatch(/final answer/i)
  })

  it('allows the model to ask the user for more turns as the only escape', () => {
    const text = buildForcedSynthesisNudge()
    // The model may request more turns (reply "continue"), but only when it
    // genuinely cannot answer — it must not silently keep calling tools.
    expect(text).toMatch(/continue/i)
    expect(text).toMatch(/more tool turns|more turns/i)
  })

  it('never emits an workspace_tool wrapper or angle-bracket placeholders', () => {
    const text = buildForcedSynthesisNudge()
    expect(text).not.toContain('<workspace_tool')
    expect(text).not.toMatch(/<value>|<https URL>/)
  })
})