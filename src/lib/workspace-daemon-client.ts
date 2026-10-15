import type { AutomationWorkerSnapshot } from './workspace-tool-automation'

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4320'

export interface WorkspaceDaemonStatus extends AutomationWorkerSnapshot {
  service?: string
  intervalMs?: number
  tickRunning?: boolean
}

export function getWorkspaceDaemonUrl(): string {
  return (process.env.WORKSPACE_DAEMON_URL || DEFAULT_DAEMON_URL).replace(/\/$/, '')
}

export async function getWorkspaceDaemonStatus(): Promise<WorkspaceDaemonStatus> {
  const token = (process.env.WORKSPACE_DAEMON_TOKEN || '').trim()
  try {
    const response = await fetch(`${getWorkspaceDaemonUrl()}/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`daemon returned ${response.status}`)
    const value = await response.json() as Partial<WorkspaceDaemonStatus>
    if (typeof value.running !== 'boolean' || typeof value.loopCount !== 'number') {
      throw new Error('daemon returned an invalid status')
    }
    return {
      running: value.running,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
      lastTickAt: typeof value.lastTickAt === 'string' ? value.lastTickAt : null,
      loopCount: value.loopCount,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
      ...(typeof value.service === 'string' ? { service: value.service } : {}),
      ...(typeof value.intervalMs === 'number' ? { intervalMs: value.intervalMs } : {}),
      ...(typeof value.tickRunning === 'boolean' ? { tickRunning: value.tickRunning } : {}),
    }
  } catch (error) {
    return {
      running: false,
      startedAt: null,
      lastTickAt: null,
      loopCount: 0,
      lastError: `WorkSpaces daemon unavailable: ${error instanceof Error ? error.message : String(error)}`,
      service: 'peakui-workspace-daemon',
    }
  }
}
