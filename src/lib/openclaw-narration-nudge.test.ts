import { describe, expect, it } from 'vitest'
import {
  __test__,
  buildNarrationNudgeText,
  describeToolDisplayName,
  type NarrationNudgeContext,
} from './openclaw-narration-nudge'

function ctx(overrides: Partial<NarrationNudgeContext> = {}): NarrationNudgeContext {
  return {
    lastSuccessfulToolRequest: null,
    proseContent: '',
    ...overrides,
  }
}

describe('buildNarrationNudgeText — invalidToolBlock', () => {
  it('returns the generic malformed-wrapper message with no example', () => {
    const text = buildNarrationNudgeText(ctx({ invalidToolBlock: true }))
    expect(text).toContain('malformed, incomplete, or duplicated')
    // Critical: no literal wrapper example, because the model copies them
    // verbatim and produces the same malformed result.
    expect(text).not.toContain('<openclaw_tool')
  })
})

describe('buildNarrationNudgeText — narration with no lastSuccessfulToolRequest', () => {
  it('returns the generic fallback example', () => {
    const text = buildNarrationNudgeText(ctx())
    expect(text).toContain('You described what you were about to do')
    expect(text).toContain('<registered tool name>')
    expect(text).toContain('the most relevant tool')
  })
})

describe('buildNarrationNudgeText — narration with lastSuccessfulToolRequest', () => {
  it('uses the per-tool wrapper example for non-unified_browser tools', () => {
    const text = buildNarrationNudgeText(
      ctx({
        lastSuccessfulToolRequest: {
          name: 'shell',
          request: { command: 'ls -la', description: '' },
        },
        proseContent: 'Running ls -la now.',
      }),
    )
    expect(text).toContain('shell')
    expect(text).toContain('<openclaw_tool name="shell">')
  })

  it('uses the unified_browser placeholder example when no page name matches', () => {
    const text = buildNarrationNudgeText(
      ctx({
        lastSuccessfulToolRequest: {
          name: 'unified_browser',
          request: {
            action: 'open',
            url: 'https://www.whalestream.com/market-data/top-options-flow?flow=all',
          },
        },
        proseContent: 'Just thinking aloud about something generic.',
      }),
    )
    expect(text).toContain('unified browser')
    expect(text).toContain('<https URL>')
  })
})

describe('buildNarrationNudgeText — unified_browser page-name pre-fill (the user bug case)', () => {
  it('pre-fills the dark-pool-flow URL when the prose names that page on WhaleStream', () => {
    const text = buildNarrationNudgeText(
      ctx({
        lastSuccessfulToolRequest: {
          name: 'unified_browser',
          request: {
            action: 'open',
            url: 'https://www.whalestream.com/market-data/top-options-flow?flow=all',
          },
        },
        proseContent:
          'I can continue. I was waiting for each page result to come back before calling the next tool. The last tool result just arrived, so I\'ll proceed to the dark pool flow page now.',
      }),
    )
    expect(text).toContain('https://www.whalestream.com/market-data/top-dark-pool-flow')
    // Should NOT still have the <https URL> placeholder in the example line.
    expect(text).not.toContain('"url":"<https URL>"')
  })

  it('pre-fills the per-ticker market-tracker URL when prose names a ticker', () => {
    const text = buildNarrationNudgeText(
      ctx({
        lastSuccessfulToolRequest: {
          name: 'unified_browser',
          request: {
            action: 'open',
            url: 'https://www.whalestream.com/market-data/top-options-flow',
          },
        },
        proseContent: 'Opening the NVDA market tracker to inspect the OI table.',
      }),
    )
    expect(text).toContain('https://www.whalestream.com/market-tracker/NVDA')
  })

  it('pre-fills the institutions URL when prose names a ticker on Unusual Whales', () => {
    const text = buildNarrationNudgeText(
      ctx({
        lastSuccessfulToolRequest: {
          name: 'unified_browser',
          request: { action: 'open', url: 'https://unusualwhales.com/dashboard' },
        },
        proseContent: 'Let me check the META institutions page for 13F changes.',
      }),
    )
    expect(text).toContain('https://unusualwhales.com/stock/META/institutions')
  })

  it('pre-fills the institutional-ownership URL on HoldingsChannel', () => {
    const text = buildNarrationNudgeText(
      ctx({
        lastSuccessfulToolRequest: {
          name: 'unified_browser',
          request: { action: 'open', url: 'https://www.holdingschannel.com/' },
        },
        proseContent: 'Pulling the NVDA institutional ownership page.',
      }),
    )
    expect(text).toContain('https://www.holdingschannel.com/institutional/holders-of-nvda/')
  })
})

describe('buildNarrationNudgeText — output invariants', () => {
  it('always tells the model it can answer in plain text if no tool is needed', () => {
    const text = buildNarrationNudgeText(ctx())
    expect(text).toContain('give your final answer directly in plain text')
  })

  it('always mentions the wrapper is mandatory and bare prose is rejected', () => {
    const text = buildNarrationNudgeText(ctx())
    expect(text).toContain('wrapper is mandatory')
    expect(text).toContain('bare prose, fenced JSON, or partial wrappers are all rejected')
  })
})

describe('describeToolDisplayName', () => {
  it('returns a human label for known tool names', () => {
    expect(describeToolDisplayName('unified_browser')).toBe('unified browser')
    expect(describeToolDisplayName('web')).toBe('web')
    expect(describeToolDisplayName('shell')).toBe('shell')
    expect(describeToolDisplayName('pdf_document')).toBe('PDF document')
  })

  it('returns a generic fallback for unknown / null / undefined', () => {
    expect(describeToolDisplayName(undefined)).toBe('the most relevant tool')
    expect(describeToolDisplayName(null)).toBe('the most relevant tool')
    expect(describeToolDisplayName('not_a_real_tool')).toBe('not_a_real_tool')
  })
})

describe('nudge page-name catalog symmetry with synthesizer', () => {
  // The nudge builder's PAGE_NAME_PATTERNS and the synthesizer's
  // KNOWN_SITE_PAGES should agree on what counts as a "page name." If a
  // new entry is added to one, the other must follow.
  it('all page names the nudge recognizes are also recoverable by the synthesizer', async () => {
    const { synthesizeToolCallFromNarration } = await import('./openclaw-narration-recovery')
    const whalestreamPrior = {
      name: 'unified_browser' as const,
      request: { action: 'open', url: 'https://www.whalestream.com/market-data/top-options-flow' },
    }
    const uwhalesPrior = {
      name: 'unified_browser' as const,
      request: { action: 'open', url: 'https://unusualwhales.com/dashboard' },
    }
    const holdingsPrior = {
      name: 'unified_browser' as const,
      request: { action: 'open', url: 'https://www.holdingschannel.com/' },
    }

    // Each prose sentence in this list must be recognized by both the
    // synthesizer and the nudge builder.
    const cases: Array<{ prose: string; prior: typeof whalestreamPrior; expectedPath: string }> = [
      { prose: 'proceed to the dark pool flow page now.', prior: whalestreamPrior, expectedPath: '/market-data/top-dark-pool-flow' },
      { prose: 'proceed to the top options flow page now.', prior: whalestreamPrior, expectedPath: '/market-data/top-options-flow' },
      { prose: 'opening the SPY market tracker now.', prior: whalestreamPrior, expectedPath: '/market-tracker/SPY' },
      { prose: 'open the META institutions page.', prior: uwhalesPrior, expectedPath: '/stock/META/institutions' },
      { prose: 'open the NVDA institutional ownership page.', prior: holdingsPrior, expectedPath: '/institutional/holders-of-nvda/' },
    ]
    for (const { prose, prior, expectedPath } of cases) {
      const synth = synthesizeToolCallFromNarration(prose, { lastSuccessfulToolRequest: prior })
      expect(synth, `synthesizer missed: "${prose}"`).not.toBeNull()
      const synthUrl = (synth!.args as { url: string }).url
      expect(synthUrl).toContain(expectedPath)

      const nudge = buildNarrationNudgeText(
        ctx({ lastSuccessfulToolRequest: prior, proseContent: prose }),
      )
      expect(nudge, `nudge missed: "${prose}"`).toContain(synthUrl)
    }
  })
})

// Touch __test__ so the import isn't tree-shaken in a future refactor.
it('exposes __test__ helpers', () => {
  expect(__test__.WRAPPER_EXAMPLES.unified_browser).toContain('unified_browser')
  expect(__test__.TOOL_DISPLAY_NAME.shell).toBe('shell')
})
