import { describe, expect, it } from 'vitest'
import { buildContextBudget, deriveEpisodeRange, scoreContextMemory } from './context-engine'

describe('context engine budgeting', () => {
  it('compacts before the advertised context window is nearly full', () => {
    const budget = buildContextBudget({ provider: 'ollama', model: 'qwen', contextWindow: 10_000 }, 5_400)
    expect(budget.usableInputTokens).toBeLessThan(8_500)
    expect(budget.pressure).toBe('compact')
  })

  it('treats ninety percent of usable input as an emergency guard', () => {
    const initial = buildContextBudget({ provider: 'openai-compatible', model: 'cloud', contextWindow: 20_000 }, 0)
    const emergency = buildContextBudget({ provider: 'openai-compatible', model: 'cloud', contextWindow: 20_000 }, Math.ceil(initial.usableInputTokens * 0.9))
    expect(emergency.pressure).toBe('emergency')
  })

  it('only makes completed older turns eligible for an episode', () => {
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'done' },
      { role: 'user' as const, content: 'second' },
      { role: 'assistant' as const, content: 'done' },
      { role: 'user' as const, content: 'active request' },
    ]
    expect(deriveEpisodeRange(messages, 2)).toEqual({ startOrdinal: 0, endOrdinal: 1 })
  })

  it('ranks memory by concrete request terms', () => {
    expect(scoreContextMemory('fix postgres migration', 'The Postgres migration passed')).toBeGreaterThan(0)
    expect(scoreContextMemory('fix postgres migration', 'A blue button was added')).toBe(0)
  })
})
