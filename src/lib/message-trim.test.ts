import { describe, expect, it } from 'vitest'
import { collapseSystemMessages, trimMessagesToFit, requireContextBudget, estimateMessageTokens } from './message-trim'
import { recentTurnStart } from './conversation-turns'

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

describe('trimMessagesToFit — preserves the first user message (objective)', () => {
  it('keeps the first user message even when trimming many middle messages', () => {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: 'FIRST USER MESSAGE - analyze stock market' },
    ]
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'assistant', content: 'middle filler ' + i + ' ' + 'x'.repeat(200) })
      messages.push({ role: 'user', content: 'middle user ' + i + ' ' + 'y'.repeat(200) })
    }
    messages.push({ role: 'assistant', content: 'recent answer ' + 'z'.repeat(200) })
    messages.push({ role: 'user', content: 'recent question ' + 'w'.repeat(200) })

    const result = trimMessagesToFit(messages, 4096, 1000, { preserveTurns: 2 })
    expect(result.trimmed).toBe(true)
    const firstUser = result.messages.find(m => (m as { role: string }).role === 'user')
    expect((firstUser as { content: string }).content).toContain('FIRST USER MESSAGE')
  })
})

describe('context budget invariants', () => {
  it('counts visible user turns, not hidden tool messages or assistant replies', () => {
    const messages = [
      { role: 'user', content: 'Objective' },
      { role: 'assistant', content: 'Working' },
      { role: 'user', content: 'Next task' },
      ...Array.from({ length: 20 }, () => ({ role: 'user', hidden: true, content: 'Shell command result: ok' })),
      { role: 'assistant', content: 'Done' },
    ]
    expect(recentTurnStart(messages, 1)).toBe(2)
    expect(recentTurnStart(messages, 2)).toBe(0)
  })

  it('counts every system message, even with understated external overhead', () => {
    const messages = [{ role: 'system', content: 's'.repeat(1600) }, { role: 'system', content: 'rag'.repeat(800) }, { role: 'user', content: 'Hello' }]
    const result = trimMessagesToFit(messages, 1024, 0)
    expect(result.fitsBudget).toBe(false)
    expect(result.tokenEstimate).toBe(estimateMessageTokens(messages))
    expect(() => requireContextBudget(messages, 1024)).toThrow('Context budget exceeded')
  })

  it('reduces the recent-turn preference to fit without orphaning an active tool chain', () => {
    const messages = Array.from({ length: 10 }, (_, index) => [
      { role: 'user', content: `Task ${index}` },
      { role: 'assistant', content: 'x'.repeat(400) },
      { role: 'user', hidden: true, content: 'Shell command result: ok' },
    ]).flat()
    const result = trimMessagesToFit(messages, 400, 0, { preserveTurns: 8 })
    expect(result.fitsBudget).toBe(true)
    expect(result.tokenEstimate).toBeLessThanOrEqual(result.inputBudget)
    expect(result.messages.slice(-3)).toEqual(messages.slice(-3))
    expect(result.messages[0]).toEqual(messages[0])
  })

  it('rejects impossible active requests and model backoff instead of truncating them', () => {
    const messages = [{ role: 'user', content: 'x'.repeat(8000), images: ['image'] }]
    expect(requireContextBudget(messages, 4096)).toEqual(messages)
    expect(() => requireContextBudget(messages, 1024)).toThrow('Context budget exceeded')
    expect(() => requireContextBudget([{ role: 'user', content: 'Hi' }], 1024, 1000)).toThrow('Context budget exceeded')
    expect(messages[0].content).toHaveLength(8000)
  })
})
