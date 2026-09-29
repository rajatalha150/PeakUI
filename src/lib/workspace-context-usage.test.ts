import { describe, expect, it } from 'vitest'
import { formatWorkspaceContextUsage, workspaceContextTierTone } from './workspace-context-usage'

describe('workspace context usage', () => {
  it('formats the same compact "tokens / window (tier)" shape as the Coder meter', () => {
    const usage = {
      model: 'qwen2.5:7b',
      totalTokens: 12400,
      contextWindow: 16384,
      occupancy: 0.75,
      tier: 'compact' as const,
    }
    expect(formatWorkspaceContextUsage(usage)).toContain('12.4k / 16.4k')
    expect(formatWorkspaceContextUsage(usage)).toContain('(compact)')
  })

  it('formats sub-1000 token counts without the k suffix', () => {
    const usage = {
      model: 'qwen2.5:7b',
      totalTokens: 512,
      contextWindow: 8192,
      occupancy: 0.06,
      tier: 'fresh' as const,
    }
    expect(formatWorkspaceContextUsage(usage)).toContain('512 / 8.2k')
  })

  it('returns unavailable for a null snapshot', () => {
    expect(formatWorkspaceContextUsage(null)).toBe('Context unavailable')
  })

  it('maps tiers to the Coder color tones', () => {
    expect(workspaceContextTierTone('fresh')).toBe('success')
    expect(workspaceContextTierTone('prepare')).toBe('warning')
    expect(workspaceContextTierTone('compact')).toBe('warning')
    expect(workspaceContextTierTone('rebuild')).toBe('danger')
    expect(workspaceContextTierTone('emergency')).toBe('danger')
  })
})
