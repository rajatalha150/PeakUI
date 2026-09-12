import { describe, expect, it, beforeEach } from 'vitest'
import { recordToolOutcome, getToolReliability, resetToolReliability } from './tool-reliability'

describe('tool-reliability', () => {
  beforeEach(() => resetToolReliability())

  it('records success and failure per model+tool', () => {
    recordToolOutcome('model-a', 'web', true)
    recordToolOutcome('model-a', 'web', false, 'timeout')
    recordToolOutcome('model-a', 'web', false, 'timeout again')

    const records = getToolReliability()
    expect(records).toHaveLength(1)
    expect(records[0].model).toBe('model-a')
    expect(records[0].tool).toBe('web')
    expect(records[0].success).toBe(1)
    expect(records[0].failure).toBe(2)
    expect(records[0].lastError).toBe('timeout again')
  })

  it('keeps model+tool pairs separate', () => {
    recordToolOutcome('model-a', 'web', true)
    recordToolOutcome('model-b', 'web', false, 'x')
    recordToolOutcome('model-a', 'shell', true)

    expect(getToolReliability()).toHaveLength(3)
  })

  it('sorts by failure rate descending (most broken first)', () => {
    recordToolOutcome('good', 'web', true)
    recordToolOutcome('good', 'web', true)
    recordToolOutcome('bad', 'shell', false, 'boom')
    recordToolOutcome('bad', 'shell', false, 'boom')

    const records = getToolReliability()
    expect(records[0].tool).toBe('shell')
    expect(records[0].failure).toBe(2)
  })

  it('truncates long error messages', () => {
    recordToolOutcome('m', 't', false, 'x'.repeat(5000))
    expect(getToolReliability()[0].lastError.length).toBeLessThanOrEqual(300)
  })

  it('reset clears the store', () => {
    recordToolOutcome('m', 't', true)
    resetToolReliability()
    expect(getToolReliability()).toHaveLength(0)
  })
})
