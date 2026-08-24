import { describe, expect, it } from 'vitest'

import {
  compactStaleToolResults,
  compactToolResultContent,
  isToolResultMessage,
} from './workspace-tool-context-compaction'

type Msg = { role: 'user' | 'assistant' | 'system'; content: string; hidden?: boolean; id?: string }

function ack(): Msg {
  return { role: 'assistant', content: 'ack' }
}

function shellResult(big = true): Msg {
  const body = big ? 'line of output\n'.repeat(400) : 'small output'
  return {
    role: 'user',
    hidden: true,
    id: 'shell-1',
    content: [
      'Shell command result:',
      'Target: container',
      'Command: ls -la /home/raza',
      'Status: completed',
      'Exit code: 0',
      'Duration: 120ms',
      '',
      'STDOUT:',
      body,
    ].join('\n'),
  }
}

function filesystemReadResult(): Msg {
  return {
    role: 'user',
    hidden: true,
    id: 'fs-1',
    content: [
      'Filesystem tool result:',
      'Action: read',
      'Path: /home/raza/notes.md',
      'Status: completed',
      'Kind: file',
      'Size: 9000 bytes',
      '',
      'File content:',
      'A'.repeat(5000),
    ].join('\n'),
  }
}

function recoveryNudge(): Msg {
  return {
    role: 'user',
    hidden: true,
    content: 'Your last message did not contain a valid tool block — re-emit exactly ONE complete tool call.',
  }
}

function realUserMessage(): Msg {
  return { role: 'user', content: 'Analyze PLTR for the current trend.' }
}

describe('isToolResultMessage', () => {
  it('recognizes every tool-result header prefix', () => {
    const headers = [
      'Shell command result:',
      'Filesystem tool result:',
      'Code execution result:',
      'Web research tool result:',
      'Browser tool result:',
      'Tax return PDF tool result:',
      'PDF document tool result:',
      'Excel workbook tool result:',
      'Word document tool result:',
      'CSV export tool result:',
      'Email writer tool result:',
      'Markdown document tool result:',
      'Slide deck tool result:',
      'Archive tool result:',
      'Calendar tool result:',
      'Mermaid diagram tool result:',
      'URL fetch and summarize tool result:',
    ]
    for (const h of headers) {
      expect(isToolResultMessage({ role: 'user', hidden: true, content: `${h}\n...` })).toBe(true)
    }
  })

  it('rejects recovery nudges, duplicate notices, and visible user messages', () => {
    expect(isToolResultMessage(recoveryNudge())).toBe(false)
    expect(isToolResultMessage({ role: 'user', hidden: true, content: 'The previous tool result for this exact request was already provided.' })).toBe(false)
    expect(isToolResultMessage(realUserMessage())).toBe(false)
    expect(isToolResultMessage({ role: 'assistant', hidden: true, content: 'Shell command result:' })).toBe(false)
    expect(isToolResultMessage({ role: 'user', hidden: false, content: 'Shell command result:' })).toBe(false)
  })
})

describe('compactToolResultContent', () => {
  it('keeps the metadata block and replaces the bulky body with a compaction note', () => {
    const compacted = compactToolResultContent(shellResult().content)
    expect(compacted).toContain('Shell command result:')
    expect(compacted).toContain('Command: ls -la /home/raza')
    expect(compacted).toContain('Status: completed')
    expect(compacted).toContain('Exit code: 0')
    expect(compacted).not.toContain('STDOUT:')
    expect(compacted).not.toContain('line of output')
    expect(compacted).toContain('earlier tool result compacted')
  })

  it('preserves the metadata block of a filesystem read result', () => {
    const compacted = compactToolResultContent(filesystemReadResult().content)
    expect(compacted).toContain('Filesystem tool result:')
    expect(compacted).toContain('Action: read')
    expect(compacted).toContain('Path: /home/raza/notes.md')
    expect(compacted).not.toContain('File content:')
  })

  it('falls back to a line cap when there is no blank line', () => {
    const content = 'Shell command result:\n' + 'metadata line\n'.repeat(40)
    const compacted = compactToolResultContent(content)
    expect(compacted).toContain('Shell command result:')
    expect(compacted).toContain('earlier tool result compacted')
    // Should not keep all 40 lines.
    expect(compacted.split('\n').length).toBeLessThan(40)
  })
})

describe('compactStaleToolResults', () => {
  it('keeps the last 4 tool results full and compacts older large ones', () => {
    const messages: Msg[] = [
      realUserMessage(),
      shellResult(), // 0 — old, large → compacted
      ack(),
      shellResult(), // old, large → compacted (id collides below; ok)
      ack(),
      filesystemReadResult(), // old, large → compacted
      ack(),
      shellResult(), // recent (4th from end) → full
      ack(),
      shellResult(), // recent → full
      ack(),
      shellResult(), // recent → full
      ack(),
      shellResult(), // recent → full
    ].map((m, i) => ({ ...m, id: m.id ? `${m.id}-${i}` : undefined }))

    const result = compactStaleToolResults(messages)
    // 3 oldest tool results compacted (indices 1, 3, 5), last 4 full.
    expect(result[1].content).toContain('earlier tool result compacted')
    expect(result[3].content).toContain('earlier tool result compacted')
    expect(result[5].content).toContain('earlier tool result compacted')
    expect(result[7].content).toContain('STDOUT:') // kept full
    expect(result[9].content).toContain('STDOUT:')
    expect(result[11].content).toContain('STDOUT:')
    expect(result[13].content).toContain('STDOUT:')
  })

  it('does not compact small tool results', () => {
    const small: Msg = { role: 'user', hidden: true, content: 'Filesystem tool result:\nAction: stat\nStatus: failed\nError: nope' }
    const result = compactStaleToolResults([small, small, small, small, small, small, small], { minCharsToCompact: 1500 })
    for (const m of result) expect(m.content).not.toContain('earlier tool result compacted')
  })

  it('leaves recovery nudges and visible user messages untouched', () => {
    const messages: Msg[] = [
      realUserMessage(),
      recoveryNudge(),
      shellResult(),
      recoveryNudge(),
      shellResult(),
      shellResult(),
      shellResult(),
      shellResult(),
    ]
    const result = compactStaleToolResults(messages)
    // The real user message and the nudges are reused verbatim.
    expect(result[0].content).toBe('Analyze PLTR for the current trend.')
    expect(result[1].content).toContain('valid tool block')
    expect(result[3].content).toContain('valid tool block')
  })

  it('returns a new array and never mutates the input', () => {
    const original = shellResult()
    const snapshot = original.content
    const out = compactStaleToolResults([original, shellResult(), shellResult(), shellResult(), shellResult(), shellResult()])
    expect(original.content).toBe(snapshot) // input untouched
    expect(out).not.toBe([original]) // new array
    expect(out.length).toBe(6)
  })

  it('compacts nothing when all results are recent', () => {
    const messages: Msg[] = [shellResult(), shellResult(), shellResult()]
    const result = compactStaleToolResults(messages)
    for (const m of result) expect(m.content).toContain('STDOUT:')
  })

  it('respects a custom keepRecent window', () => {
    const messages: Msg[] = [
      shellResult(),
      shellResult(),
      shellResult(),
      shellResult(),
      shellResult(),
    ].map((m, i) => ({ ...m, id: `r-${i}` }))
    const result = compactStaleToolResults(messages, { keepRecent: 2 })
    expect(result[0].content).toContain('earlier tool result compacted')
    expect(result[1].content).toContain('earlier tool result compacted')
    expect(result[2].content).toContain('earlier tool result compacted')
    expect(result[3].content).toContain('STDOUT:') // kept full
    expect(result[4].content).toContain('STDOUT:') // kept full
  })
})