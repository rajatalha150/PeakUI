import { describe, expect, it } from 'vitest'
import { formatCoderContextUsage, normalizeCoderContextUsage, shouldCaptureCoderHandoff } from './coder-context'

describe('coder context usage', () => {
  it('uses daemon-reported thresholds rather than a guessed window percentage', () => {
    const usage = normalizeCoderContextUsage({
      usage: {
        modelName: 'qwen-coder', totalTokens: 166627, contextWindowSize: 200000, isEstimated: false,
        breakdown: { freeSpace: 373, currentTier: 'warn', thresholds: { warn: 147000, auto: 167000, hard: 177000, effectiveWindow: 180000 } },
      },
    })
    expect(usage?.thresholds.auto).toBe(167000)
    expect(shouldCaptureCoderHandoff(usage)).toBe(true)
    expect(formatCoderContextUsage(usage)).toContain('166.6k / 200.0k')
  })

  it('does not make up usage from malformed daemon payloads', () => {
    expect(normalizeCoderContextUsage({ usage: { totalTokens: 'a lot' } })).toBeNull()
  })

  it('normalizes Qwen daemon versions that call the healthy tier safe', () => {
    const usage = normalizeCoderContextUsage({ usage: {
      totalTokens: 100, contextWindowSize: 1000, breakdown: { currentTier: 'safe', thresholds: {} },
    } })
    expect(usage?.tier).toBe('fresh')
    expect(shouldCaptureCoderHandoff(usage)).toBe(false)
  })
})
