import { describe, expect, it } from 'vitest'
import { getNextCronRun, validateCronExpression } from './workspace-tool-automation'

describe('WorkspaceTool automation scheduling', () => {
  it('accepts a standard five-field cron expression', () => {
    expect(() => validateCronExpression('0 9 * * 1-5')).not.toThrow()
  })

  it('rejects cron expressions with the wrong field count', () => {
    expect(() => validateCronExpression('0 9 * *')).toThrow(/exactly 5 fields/i)
  })

  it('rejects out-of-range cron values', () => {
    expect(() => validateCronExpression('61 * * * *')).toThrow(/invalid cron/i)
  })

  it('computes the next matching run in UTC for stepped minutes', () => {
    const next = getNextCronRun('*/15 * * * *', 'UTC', new Date('2026-05-26T10:07:20.000Z'))
    expect(next.toISOString()).toBe('2026-05-26T10:15:00.000Z')
  })

  it('computes the next matching hourly run in UTC', () => {
    const next = getNextCronRun('30 14 * * *', 'UTC', new Date('2026-05-26T14:30:00.000Z'))
    expect(next.toISOString()).toBe('2026-05-27T14:30:00.000Z')
  })
})
