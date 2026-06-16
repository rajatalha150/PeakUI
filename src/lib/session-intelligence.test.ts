import { describe, expect, it } from 'vitest'
import {
  applyContextManagement,
  buildSessionContextSummary,
  computeSessionAnalytics,
  filterRelevantCrossSessionMemory,
  hasPendingContinuation,
  isContinuationWorkspacePrompt,
  isCrossSessionMemoryRelevant,
  isLowSignalWorkspacePrompt,
  type SessionMessageLike,
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
    expect(summary).toContain('## Objective')
    expect(summary).toContain('Plan the migration')
    expect(summary).toContain('## Current status')
    expect(summary).toContain('Start by auditing dependencies.')
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

  it('does not promote greetings into the thread objective', () => {
    const messages = [
      { role: 'user' as const, content: 'hello', createdAt: '2026-05-30T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'Hello, what would you like to work on?', createdAt: '2026-05-30T10:00:01.000Z' },
      { role: 'user' as const, content: 'analyze pltr for me check current options flow', createdAt: '2026-05-30T10:00:02.000Z' },
      { role: 'assistant' as const, content: 'Best next action: open WhaleStream for latest PLTR options flow.', createdAt: '2026-05-30T10:00:03.000Z' },
      { role: 'user' as const, content: 'go ahead', createdAt: '2026-05-30T10:00:04.000Z' },
    ]

    const result = applyContextManagement(messages, {
      contextLength: 8192,
      systemOverhead: 500,
      existingSummary: '## Objective\n- hello',
      summaryEnabled: true,
      summaryTargetTokens: 6000,
      preserveTurns: 2,
    })

    expect(isLowSignalWorkspacePrompt('hello')).toBe(true)
    expect(isContinuationWorkspacePrompt('go ahead')).toBe(true)
    expect(result.contextSummary).not.toContain('- hello')
    expect(result.messages.some(message => message.content?.includes('analyze pltr'))).toBe(true)
    expect(result.messages.some(message => message.content?.includes('go ahead'))).toBe(true)
  })

  it('keeps older decisions in structured working memory', () => {
    const messages = [
      { role: 'user' as const, content: 'We decided to use Firebase for the iOS app backend.', createdAt: '2026-05-30T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'Decision captured.', createdAt: '2026-05-30T10:00:01.000Z' },
      { role: 'user' as const, content: 'Next, design the invite polling flow.', createdAt: '2026-05-30T10:00:02.000Z' },
      { role: 'assistant' as const, content: 'The next step is to draft the data model.', createdAt: '2026-05-30T10:00:03.000Z' },
      { role: 'user' as const, content: 'Now focus on calendar sync.', createdAt: '2026-05-30T10:00:04.000Z' },
      { role: 'assistant' as const, content: 'Calendar sync will use EventKit.', createdAt: '2026-05-30T10:00:05.000Z' },
      { role: 'user' as const, content: 'Then prepare the TestFlight checklist.', createdAt: '2026-05-30T10:00:06.000Z' },
      { role: 'assistant' as const, content: 'TestFlight checklist will follow.', createdAt: '2026-05-30T10:00:07.000Z' },
    ]

    const summary = buildSessionContextSummary(messages, { preserveTurns: 2 })

    expect(summary).toContain('## Important decisions')
    expect(summary).toContain('Firebase')
    expect(summary).toContain('## Next step')
    expect(summary).toContain('invite polling flow')
  })

  it('keeps compact tool results instead of transcript blobs', () => {
    const messages = [
      { role: 'user' as const, content: 'Generate a PDF report.', createdAt: '2026-05-30T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'Running PDF document tool', toolRequest: 'pdf_document' as const, createdAt: '2026-05-30T10:00:01.000Z' },
      {
        role: 'user' as const,
        hidden: true,
        content: `PDF document tool result: Created downloadable PDF artifact at /api/canvas/artifacts/abc/download ${'x'.repeat(1000)}`,
        createdAt: '2026-05-30T10:00:02.000Z',
      },
      { role: 'assistant' as const, content: 'The report is ready to download.', createdAt: '2026-05-30T10:00:03.000Z' },
      { role: 'user' as const, content: 'Now make a Word version.', createdAt: '2026-05-30T10:00:04.000Z' },
      { role: 'assistant' as const, content: 'I will create the Word document next.', createdAt: '2026-05-30T10:00:05.000Z' },
      { role: 'user' as const, content: 'After that, add a workbook version.', createdAt: '2026-05-30T10:00:06.000Z' },
      { role: 'assistant' as const, content: 'The workbook version is next.', createdAt: '2026-05-30T10:00:07.000Z' },
    ]

    const summary = buildSessionContextSummary(messages, { preserveTurns: 2 })

    expect(summary).toContain('## Files, folders, artifacts')
    expect(summary).toContain('downloadable PDF artifact')
    expect(summary.length).toBeLessThan(1800)
  })

  it('lets newer raw transcript override older memory by instruction', () => {
    const result = applyContextManagement<SessionMessageLike>([
      { role: 'user', content: 'Always draft reports in a very formal tone.' },
      { role: 'assistant', content: 'Preference noted.' },
      { role: 'user', content: 'For this next answer, be casual and short.' },
    ], {
      contextLength: 2048,
      systemOverhead: 100,
      existingSummary: '## User preferences\n- Always draft reports in a very formal tone.',
      summaryEnabled: true,
      summaryTargetTokens: 512,
      preserveTurns: 2,
    })

    const memoryMessage = result.messages.find(message => message.role === 'system' && message.content?.includes('Working memory for this thread.'))
    expect(memoryMessage?.content).toContain('prefer the newer messages')
    expect(result.messages[result.messages.length - 1]?.content).toContain('casual and short')
  })

  it('filters unrelated cross-session memory', () => {
    const memory = 'Recent memory context:\n- Tax PDF workflow: user wants Form 1040 generation.'
    expect(isCrossSessionMemoryRelevant(memory, 'Build an iOS invite polling app')).toBe(false)
    expect(filterRelevantCrossSessionMemory(memory, 'Improve the tax PDF workflow')).toContain('Tax PDF workflow')
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
