import { describe, expect, it } from 'vitest'
import {
  applyContextManagement,
  buildSessionContextSummary,
  computeSessionAnalytics,
  hasPendingContinuation,
} from './session-intelligence'
import { trimMessagesToFit } from './message-trim'

describe('session intelligence', () => {
  it('builds a rolling summary from older turns', () => {
    const messages = [
      { role: 'system' as const, content: 'System prompt' },
      { role: 'user' as const, content: 'Plan the migration', createdAt: '2026-05-30T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'Start by auditing dependencies.', createdAt: '2026-05-30T10:00:05.000Z' },
      { role: 'user' as const, content: 'Check the deployment workflow too.', createdAt: '2026-05-30T10:00:10.000Z' },
      { role: 'assistant' as const, content: 'Deployment currently depends on a hand-run build.', createdAt: '2026-05-30T10:00:15.000Z' },
      { role: 'user' as const, content: 'What is the next concrete step?', createdAt: '2026-05-30T10:00:20.000Z' },
      { role: 'assistant' as const, content: 'Write the migration checklist and test matrix.', createdAt: '2026-05-30T10:00:25.000Z' },
    ]

    const summary = buildSessionContextSummary(messages, { preserveTurns: 2 })
    expect(summary).toContain('User request: Plan the migration')
    expect(summary).toContain('Assistant response: Start by auditing dependencies.')
  })

  it('summarizes long sessions before trimming them blindly', () => {
    const longMessages = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${index} ${'x'.repeat(320)}`,
      createdAt: new Date(2026, 4, 30, 10, 0, index).toISOString(),
    }))

    const result = applyContextManagement(longMessages, {
      contextLength: 2048,
      systemOverhead: 120,
      existingSummary: '',
      summaryEnabled: true,
      summaryTargetTokens: 512,
      preserveTurns: 3,
    })

    expect(result.summaryUsed).toBe(true)
    expect(result.contextSummary.length).toBeGreaterThan(0)
    expect(['summarized', 'trimmed']).toContain(result.contextHealth)
  })

  it('builds memory once older turns fall outside the preserved window', () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Turn ${index} about the tax packet workflow`,
      createdAt: new Date(2026, 4, 30, 10, 0, index).toISOString(),
    }))

    const result = applyContextManagement(messages, {
      contextLength: 8192,
      systemOverhead: 500,
      existingSummary: '',
      summaryEnabled: true,
      summaryTargetTokens: 6000,
      preserveTurns: 3,
    })

    expect(result.summaryUsed).toBe(true)
    expect(result.contextSummary).toContain('tax packet workflow')
  })

  it('does not double count system prompt tokens when trimming chat memory', () => {
    const system = { role: 'system' as const, content: 'x'.repeat(2400) }
    const turns = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Important turn ${index} ${'y'.repeat(120)}`,
    }))

    const result = trimMessagesToFit([system, ...turns], 4096, 620, { preserveTurns: 3 })

    expect(result.trimmed).toBe(false)
    expect(result.messages).toHaveLength(7)
  })

  it('computes analytics from stored message meta', () => {
    const analytics = computeSessionAnalytics([
      { role: 'user', content: 'hello', createdAt: '2026-05-30T10:00:00.000Z' },
      {
        role: 'assistant',
        content: 'world',
        toolRequest: 'shell',
        createdAt: '2026-05-30T10:00:02.000Z',
        meta: { tokens: 120, duration: 2.5, tps: 48 },
      },
      {
        role: 'user',
        content: 'Shell command result: ok',
        hidden: true,
        createdAt: '2026-05-30T10:00:04.000Z',
      },
    ])

    expect(analytics.assistantTokens).toBe(120)
    expect(analytics.toolCalls).toBe(1)
    expect(analytics.toolCallsByType.shell).toBe(1)
    expect(analytics.timeSpanSeconds).toBe(4)
  })

  it('detects pending continuation when the last visible assistant message is a tool request', () => {
    expect(hasPendingContinuation([
      { role: 'user', content: 'Inspect repo' },
      { role: 'assistant', content: 'Running shell command: `git status`', toolRequest: 'shell' },
    ])).toBe(true)

    expect(hasPendingContinuation([
      { role: 'user', content: 'Inspect repo' },
      { role: 'assistant', content: 'Running shell command: `git status`', toolRequest: 'shell' },
      { role: 'user', content: 'Shell command result: clean', hidden: true },
    ])).toBe(false)
  })
})
