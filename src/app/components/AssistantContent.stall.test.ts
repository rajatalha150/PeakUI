import { describe, expect, it } from 'vitest'
import { parseStructuredBlocks } from './AssistantContent'

/**
 * Streaming-render stall budget.
 *
 * The chat renderer re-parses the entire accumulated message on every token
 * during streaming. If that parse is superlinear in message length, the bubble
 * visibly freezes as the reply grows — the "transition starvation" failure
 * Unsloth fixed with a dedicated harness. This test locks in a budget for the
 * pure parser so a regression that makes it O(n²) (or just slow) fails CI.
 *
 * The budget is generous (a full 8 KB reply must parse in well under 50 ms on
 * any CI runner) but catches the catastrophic case: a parser that scales
 * quadratically would blow past it on a 32 KB message.
 */

function buildStreamedReply(totalChars: number): string {
  const unit =
    'The printing press did not arrive as a single invention so much as a ' +
    'convergence of movable type, a workable oil-based ink, and a screw press.\n\n' +
    '## Findings\n\n' +
    '- First point with some detail\n' +
    '- Second point\n\n' +
    '```python\nprint("hello")\n```\n\n' +
    '| Item | Amount |\n| --- | --- |\n| Hosting | $299 |\n'
  let out = ''
  while (out.length < totalChars) out += unit
  return out.slice(0, totalChars)
}

describe('parseStructuredBlocks — streaming stall budget', () => {
  it('parses a full 8 KB reply within the stall budget', () => {
    const content = buildStreamedReply(8_192)
    const start = performance.now()
    const blocks = parseStructuredBlocks(content)
    const elapsed = performance.now() - start
    expect(blocks.length).toBeGreaterThan(0)
    // Generous budget: a linear parser does this in ~1 ms; a quadratic one
    // would take hundreds of ms on the same input.
    expect(elapsed).toBeLessThan(50)
  })

  it('scales roughly linearly (32 KB is not 16x the 8 KB cost)', () => {
    const small = buildStreamedReply(8_192)
    const large = buildStreamedReply(32_768)

    const t0 = performance.now()
    parseStructuredBlocks(small)
    const smallMs = performance.now() - t0

    const t1 = performance.now()
    parseStructuredBlocks(large)
    const largeMs = performance.now() - t1

    // 4x the input should cost well under 16x the time (linear would be ~4x).
    // This catches superlinear blowups without being flaky on slow runners.
    expect(largeMs).toBeLessThan(Math.max(smallMs * 16, 50))
  })

  it('handles a long fenced code block without pathological cost', () => {
    const code = 'x'.repeat(20_000)
    const content = `Here is a script:\n\n\`\`\`python\n${code}\n\`\`\`\n\nDone.`
    const start = performance.now()
    const blocks = parseStructuredBlocks(content)
    const elapsed = performance.now() - start
    expect(blocks.some(b => b.type === 'code')).toBe(true)
    expect(elapsed).toBeLessThan(50)
  })
})
