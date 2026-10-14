import { describe, expect, it } from 'vitest'
import { activityDisplayStatus, mergeActivity, previewCheckpointOf, restoreVerifications } from './coder-activity'
import type { ToolActivity } from './coder-transcript'

const checkpoint: ToolActivity = {
  id: 'preview-1', title: 'Preview', status: 'completed', detail: '', startedAt: 20,
  toolName: 'Vision review', rawInput: {
    kind: 'preview-checkpoint', screenshotPath: '/workspace/.peakui-attachments/s/shot.jpg',
    url: 'http://localhost:8081', device: 'desktop', width: 1280, height: 800,
    capturedAt: 20, visionModel: 'vision', observation: 'Login form', diagnostics: [],
  },
}

describe('Coder activity evidence', () => {
  it('rejects incomplete persisted screenshots instead of crashing diagnostic rendering', () => {
    expect(previewCheckpointOf(checkpoint)?.observation).toBe('Login form')
    for (const override of [{ diagnostics: undefined }, { diagnostics: [null] }, { width: NaN }, { device: 'invalid' }]) {
      expect(previewCheckpointOf({ ...checkpoint, rawInput: { ...checkpoint.rawInput as object, ...override } })).toBeNull()
    }
  })

  it('retains checkpoints once, in chronology, across repeated daemon refreshes', () => {
    const tool = { id: 'tool', title: 'Write', status: 'completed', detail: '', startedAt: 30 }
    const merged = mergeActivity([tool], [checkpoint])
    expect(merged.map(item => item.id)).toEqual(['preview-1', 'tool'])
    expect(mergeActivity([tool], merged)).toEqual(merged)
  })

  it('does not invent successful or failed tool results when an idle turn has unfinished activity', () => {
    expect(activityDisplayStatus('in_progress', true, false)).toBe('ended')
    expect(activityDisplayStatus('in_progress', true, true)).toBe('cancelled')
    expect(activityDisplayStatus('in_progress', false, false)).toBe('in_progress')
    expect(activityDisplayStatus('failed', true, true)).toBe('failed')
  })

  it('does not resurrect unresolved old calls, but accepts a late real result', () => {
    const old = { id: 'tool', title: 'Shell', status: 'ended', detail: '', startedAt: 1 }
    expect(mergeActivity([{ ...old, status: 'in_progress' }], [old])[0].status).toBe('ended')
    expect(mergeActivity([{ ...old, status: 'completed' }], [old])[0].status).toBe('completed')
  })

  it('retains verification results but invalidates freshness after reopening', () => {
    const record = { id: 'check', command: 'npm test', cwd: '/workspace', exitCode: 1, startedAt: 1, finishedAt: 2, output: 'failed', mutation: 3 }
    expect(restoreVerifications([record, null, {}])).toEqual([{ ...record, mutation: -1 }])
    expect(restoreVerifications(undefined)).toEqual([])
  })
})
