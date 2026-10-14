import type { ToolActivity } from './coder-transcript'
import type { PreviewDevice } from './coder-preview'
import type { VerificationRecord } from './coder-verification'

export interface PreviewCheckpoint {
  kind: 'preview-checkpoint'
  screenshotPath: string
  url: string
  device: PreviewDevice
  width: number
  height: number
  capturedAt: number
  visionModel: string
  observation: string
  diagnostics: Array<{ level: string; message: string }>
}

export function previewCheckpointOf(activity: ToolActivity): PreviewCheckpoint | null {
  if (activity.toolName !== 'Vision review') return null
  const input = activity.rawInput
  if (!input || typeof input !== 'object') return null
  const item = input as Partial<PreviewCheckpoint>
  if (item.kind !== 'preview-checkpoint' || typeof item.screenshotPath !== 'string'
    || !item.screenshotPath.startsWith('/') || typeof item.url !== 'string'
    || !['desktop', 'tablet', 'mobile'].includes(item.device || '')
    || typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width <= 0
    || typeof item.height !== 'number' || !Number.isFinite(item.height) || item.height <= 0
    || typeof item.capturedAt !== 'number' || !Number.isFinite(item.capturedAt)
    || typeof item.visionModel !== 'string' || typeof item.observation !== 'string'
    || !Array.isArray(item.diagnostics)
    || !item.diagnostics.every(entry => entry && typeof entry.level === 'string' && typeof entry.message === 'string')) return null
  return item as PreviewCheckpoint
}

/** Preserve local evidence without pinning it ahead of newer daemon events. */
export function mergeActivity(incoming: ToolActivity[], previous: ToolActivity[]): ToolActivity[] {
  const prior = new Map(previous.map(item => [item.id, item]))
  const items = new Map(incoming.map(item => {
    const old = prior.get(item.id)
    const ended = old && ['ended', 'cancelled'].includes(old.status)
    const pending = ['in_progress', 'running'].includes(item.status)
    return [item.id, ended && pending ? { ...item, status: old.status } : item]
  }))
  for (const item of previous) {
    if (previewCheckpointOf(item) && !items.has(item.id)) items.set(item.id, item)
  }
  return [...items.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

export function activityDisplayStatus(status: string, idle: boolean, stopped: boolean): string {
  if (idle && (status === 'running' || status === 'in_progress')) return stopped ? 'cancelled' : 'ended'
  return status
}

/** A reopened view cannot prove that the workspace stayed unchanged while away. */
export function restoreVerifications(value: unknown): VerificationRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is VerificationRecord => item && typeof item === 'object'
    && typeof item.id === 'string' && typeof item.command === 'string' && typeof item.cwd === 'string'
    && (item.exitCode === null || (typeof item.exitCode === 'number' && Number.isFinite(item.exitCode)))
    && typeof item.startedAt === 'number' && Number.isFinite(item.startedAt)
    && typeof item.finishedAt === 'number' && Number.isFinite(item.finishedAt)
    && typeof item.output === 'string').map(item => ({ ...item, mutation: -1 }))
}
