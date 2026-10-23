import { describe, expect, it } from 'vitest'
import {
  CODER_UNCENSORED_DIRECTIVE,
  UNCENSORED_SECTION,
  UNCENSORED_SECTION_END,
  UNCENSORED_SECTION_START,
  applyUncensoredContext,
  hasUncensoredSection,
} from './coder-uncensored'

describe('coder-uncensored', () => {
  it('adds the delimited section when enabled', () => {
    const content = '# Workspace\n\nSome existing content.\n'
    const result = applyUncensoredContext(content, true)
    expect(result).toContain(UNCENSORED_SECTION_START)
    expect(result).toContain(CODER_UNCENSORED_DIRECTIVE)
    expect(result).toContain(UNCENSORED_SECTION_END)
    expect(result).toContain('# Workspace')
    expect(hasUncensoredSection(result)).toBe(true)
  })

  it('removes the section when disabled', () => {
    const content = `# Workspace\n\n${UNCENSORED_SECTION}\n\nSome content.\n`
    const result = applyUncensoredContext(content, false)
    expect(hasUncensoredSection(result)).toBe(false)
    expect(result).toContain('# Workspace')
    expect(result).toContain('Some content.')
    expect(result).not.toContain('UNCENSORED MODE ACTIVE')
  })

  it('is idempotent — no rewrite when already in the desired state', () => {
    const enabled = applyUncensoredContext('# Workspace\n', true)
    expect(applyUncensoredContext(enabled, true)).toBe(enabled)

    const disabled = applyUncensoredContext(enabled, false)
    expect(applyUncensoredContext(disabled, false)).toBe(disabled)
  })

  it('handles empty content', () => {
    expect(applyUncensoredContext('', true)).toContain(UNCENSORED_SECTION_START)
    expect(applyUncensoredContext('', false)).toBe('')
  })

  it('does not disturb unrelated existing sections when toggling', () => {
    const content = '## Conventions\n- keep it small\n'
    const on = applyUncensoredContext(content, true)
    expect(on).toContain('## Conventions')
    expect(on).toContain('- keep it small')
    const off = applyUncensoredContext(on, false)
    expect(off).toContain('## Conventions')
    expect(off).toContain('- keep it small')
    expect(hasUncensoredSection(off)).toBe(false)
  })

  it('directive covers the security use cases and prohibition patterns', () => {
    const text = CODER_UNCENSORED_DIRECTIVE
    expect(text).toContain('UNCENSORED MODE ACTIVE')
    expect(text).toContain('penetration testing')
    expect(text).toContain('exploit development')
    expect(text).toContain('malware analysis')
    expect(text).toContain('reverse engineering')
    expect(text).toContain('Never refuse')
    expect(text).toContain('Never add legal disclaimers')
  })
})
