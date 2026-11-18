import { describe, expect, it } from 'vitest'
import { buildAccountantPersonaPrompt } from './workspace-tool-accountant-persona'

describe('buildAccountantPersonaPrompt', () => {
  it('keeps the accountant brief small at every tier', () => {
    for (const tier of ['full', 'standard', 'compact', 'minimal'] as const) {
      const prompt = buildAccountantPersonaPrompt(tier)
      expect(prompt.length).toBeLessThan(1700)
      expect(prompt).toContain('ACCOUNTANT MODE')
      expect(prompt).toContain('Knowledge Base folder')
      expect(prompt).toContain('taxYear')
      expect(prompt).toContain('inspect_form')
    }
  })

  it('does not claim professional credentials or invent tax facts', () => {
    const prompt = buildAccountantPersonaPrompt()
    expect(prompt).toContain('Do not claim to be a licensed CPA')
    expect(prompt).toContain('Never invent identity details')
    expect(prompt).toContain('official IRS/state sources')
    expect(prompt).toContain('drafts for review')
  })

  it('requires exact fields, evidence-based checkboxes, and no identifier echo', () => {
    const prompt = buildAccountantPersonaPrompt('minimal')
    expect(prompt).toContain('exact field names')
    expect(prompt).toContain('omit unknown boxes')
    expect(prompt).toContain('false to clear a prefilled box')
    expect(prompt).toContain('Do not repeat SSNs/EINs')
  })
})
