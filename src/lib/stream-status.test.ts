import { describe, expect, it } from 'vitest'
import { getStreamPhaseLabel, isServerStreamStatus } from './stream-status'

describe('stream status progress', () => {
  it('accepts durable WorkSpaces lifecycle phases', () => {
    expect(isServerStreamStatus('queued')).toBe(true)
    expect(isServerStreamStatus('model-thinking')).toBe(true)
    expect(isServerStreamStatus('tool-completed')).toBe(true)
    expect(isServerStreamStatus('finalizing')).toBe(true)
    expect(isServerStreamStatus('not-a-status')).toBe(false)
  })

  it('keeps progress labels specific to the current stage', () => {
    expect(getStreamPhaseLabel('queued')).toContain('Queued')
    expect(getStreamPhaseLabel('model-reviewing')).toContain('Reviewing')
    expect(getStreamPhaseLabel('tool-completed')).toContain('reviewing')
    expect(getStreamPhaseLabel('finalizing')).toContain('Saving')
  })
})
