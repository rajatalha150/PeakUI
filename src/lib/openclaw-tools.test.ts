import { describe, expect, it } from 'vitest'
import { extractOpenClawToolRequest, stripAllToolTags } from './openclaw-tools'

describe('openclaw tool parsing', () => {
  it('parses the first valid unified browser request from a legacy tag with concatenated JSON', () => {
    const input = [
      'Search now.',
      '<unified_browser>',
      '{"action":"search","query":"dark web palantir","browserMode":"stealth","providerId":"ahmia"}',
      '{"action":"search","query":"pltr market cap","browserMode":"direct"}',
      '</unified_browser>',
      'After that, summarize.',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('unified_browser')
    expect(extracted.request && extracted.request.name === 'unified_browser'
      ? extracted.request.request.providerId
      : undefined).toBe('ahmia')
    expect(extracted.cleanedContent).toContain('Search now.')
    expect(extracted.cleanedContent).toContain('After that, summarize.')
  })

  it('strips both modern and legacy browser tool tags from content', () => {
    const modern = '<openclaw_tool name="unified_browser">{"action":"search","query":"x"}</openclaw_tool>'
    const legacy = '<unified_browser>{"action":"search","query":"y"}</unified_browser>'
    expect(stripAllToolTags(`Before\n${modern}\nAfter`)).toBe('Before\n\nAfter')
    expect(stripAllToolTags(`Before\n${legacy}\nAfter`)).toBe('Before\n\nAfter')
  })
})
