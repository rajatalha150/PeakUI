import { describe, expect, it } from 'vitest'
import { normalizeStoredChatMessage, parseStoredChatMessages } from './chat-sessions'
import { WORKSPACE_TOOL_NAMES } from './workspace-tool-tools'

describe('normalizeStoredChatMessage — hidden tool-result detection', () => {
  it('hides "Shell command result:" (no "tool" word)', () => {
    const msg = normalizeStoredChatMessage({ role: 'user', content: 'Shell command result:\nTarget: container\nStatus: completed' })
    expect(msg?.hidden).toBe(true)
  })

  it('hides "Code execution result:" (no "tool" word)', () => {
    const msg = normalizeStoredChatMessage({ role: 'user', content: 'Code execution result:\nStatus: completed' })
    expect(msg?.hidden).toBe(true)
  })

  it('hides "<tool> tool result:" prefixes', () => {
    for (const content of [
      'Filesystem tool result:',
      'Web research tool result:',
      'Tax return tool result:',
      'Notes save tool result:',
      'Image generation tool result:',
      'Spreadsheet query tool result:',
      'Calendar query tool result:',
      'HTTP request tool result:',
    ]) {
      expect(normalizeStoredChatMessage({ role: 'user', content: content + '\nStatus: completed' })?.hidden).toBe(true)
    }
  })

  it('does NOT hide normal user messages that mention "result"', () => {
    expect(normalizeStoredChatMessage({ role: 'user', content: 'The result of the analysis is positive' })?.hidden).toBeUndefined()
    expect(normalizeStoredChatMessage({ role: 'user', content: 'Here is my answer' })?.hidden).toBeUndefined()
  })

  it('does NOT hide assistant messages even if they look like results', () => {
    const msg = normalizeStoredChatMessage({ role: 'assistant', content: 'Shell command result: clean' })
    expect(msg?.hidden).toBeUndefined()
  })
})

describe('parseStoredChatMessages tool analytics metadata', () => {
  it('preserves every supported tool request across persistence', () => {
    const stored = WORKSPACE_TOOL_NAMES.map((toolRequest, index) => ({
      id: String(index),
      role: 'assistant',
      content: `Running ${toolRequest}`,
      toolRequest,
    }))

    expect(parseStoredChatMessages(JSON.stringify(stored)).map(message => message.toolRequest))
      .toEqual(WORKSPACE_TOOL_NAMES)
  })

  it('drops unknown tool request identifiers', () => {
    const [message] = parseStoredChatMessages(JSON.stringify([
      { role: 'assistant', content: 'Running unknown tool', toolRequest: 'not_a_real_tool' },
    ]))

    expect(message.toolRequest).toBeUndefined()
  })
})
