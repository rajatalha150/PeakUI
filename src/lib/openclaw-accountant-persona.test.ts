import { describe, expect, it } from 'vitest'
import { buildAccountantPersonaPrompt } from './openclaw-accountant-persona'

describe('buildAccountantPersonaPrompt', () => {
  it('establishes a CPA / accountant / financial advisor identity', () => {
    const text = buildAccountantPersonaPrompt()
    expect(text).toMatch(/Certified Public Accountant|CPA/i)
    expect(text).toMatch(/accountant/i)
    expect(text).toMatch(/financial advisor/i)
  })

  it('teaches the tax_return workflow with the new actions', () => {
    const text = buildAccountantPersonaPrompt()
    expect(text).toContain('list_forms')
    expect(text).toContain('inspect_form')
    expect(text).toContain('fill_pdf_form')
    expect(text).toContain('formId')
    expect(text).toContain('fields')
  })

  it('never emits an openclaw_tool wrapper or angle-bracket placeholders', () => {
    const text = buildAccountantPersonaPrompt()
    expect(text).not.toContain('<openclaw_tool')
    expect(text).not.toMatch(/<value>|<https URL>/)
  })

  it('carries the due-diligence / draft-not-filed guardrail', () => {
    const text = buildAccountantPersonaPrompt()
    expect(text).toMatch(/DRAFT for review/i)
    expect(text).toMatch(/verify before filing/i)
  })

  it('teaches checkbox check/leave-alone semantics', () => {
    const text = buildAccountantPersonaPrompt()
    // Check via truthy value...
    expect(text).toMatch(/CHECK a box.*truthy/i)
    // ...leave unchecked by omitting (not by sending "no").
    expect(text).toMatch(/LEAVE a box unchecked.*OMIT/i)
    expect(text).toMatch(/Do not send "no" or "false"/i)
    // Only check boxes the facts support.
    expect(text).toMatch(/Never check a box the facts do not support/i)
  })

  it('requires a scoped Knowledge Base folder before filling', () => {
    const text = buildAccountantPersonaPrompt()
    expect(text).toMatch(/no folder is scoped/i)
    expect(text).toMatch(/do not invent client data/i)
  })
})