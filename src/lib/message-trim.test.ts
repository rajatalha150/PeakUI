import { describe, expect, it } from 'vitest'
import { collapseSystemMessages } from './message-trim'

describe('collapseSystemMessages', () => {
  it('keeps a single leading system message unchanged', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ]
    expect(collapseSystemMessages(messages)).toEqual(messages)
  })

  it('merges a second system message injected right after the system prompt', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Working memory: goal X.' },
      { role: 'user', content: 'Hi' },
    ]
    expect(collapseSystemMessages(messages)).toEqual([
      { role: 'system', content: 'You are helpful.\n\nWorking memory: goal X.' },
      { role: 'user', content: 'Hi' },
    ])
  })

  it('moves a system message that appears after user/assistant content to the front', () => {
    // This is the uncensored-mode shape: a reinforcement system message is
    // injected after few-shot priming user/assistant exchanges.
    const messages = [
      { role: 'system', content: 'Be direct.' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'system', content: 'Continue the same way.' },
      { role: 'user', content: 'Q2' },
    ]
    expect(collapseSystemMessages(messages)).toEqual([
      { role: 'system', content: 'Be direct.\n\nContinue the same way.' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ])
  })

  it('merges three system messages and preserves non-system order', () => {
    const messages = [
      { role: 'system', content: 'Prompt' },
      { role: 'system', content: 'Tree summary' },
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'system', content: 'KB context' },
      { role: 'user', content: 'C' },
    ]
    expect(collapseSystemMessages(messages)).toEqual([
      { role: 'system', content: 'Prompt\n\nTree summary\n\nKB context' },
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' },
    ])
  })

  it('returns messages unchanged when there are no system messages', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]
    expect(collapseSystemMessages(messages)).toBe(messages)
  })

  it('handles an empty message array', () => {
    expect(collapseSystemMessages([])).toEqual([])
  })

  it('drops empty system messages while preserving the rest', () => {
    const messages = [
      { role: 'system', content: '   ' },
      { role: 'user', content: 'Hi' },
    ]
    expect(collapseSystemMessages(messages)).toEqual([{ role: 'user', content: 'Hi' }])
  })
})
