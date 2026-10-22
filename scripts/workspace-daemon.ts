import http from 'node:http'
import { Client } from 'pg'
import { runAutomationTick, updateAutomationWorkerSnapshot, getAutomationWorkerSnapshot } from '../src/lib/workspace-tool-automation'
import { processQueuedWorkspaceAgentRuns } from '../src/lib/workspace-agent-run'

const bindHost = process.env.WORKSPACE_DAEMON_BIND || '127.0.0.1'
const port = Number(process.env.WORKSPACE_DAEMON_PORT || '4320')
// Queue dispatch is lightweight and must not leave an interactive turn parked
// in “connecting” for half a minute. Long model work is detached by the run
// scheduler, so this tick remains quick.
const intervalMs = Math.max(5_000, Number(process.env.WORKSPACE_DAEMON_INTERVAL_MS || '5000'))
const sharedToken = (process.env.WORKSPACE_DAEMON_TOKEN || '').trim()
const advisoryLockKey = 2_047_321_119

let stopping = false
let workspaceDispatchRunning = false
let automationTickRunning = false
let lockClient: Client | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let server: http.Server | null = null

function authorized(request: http.IncomingMessage): boolean {
  if (!sharedToken) return bindHost === '127.0.0.1' || bindHost === 'localhost'
  return request.headers.authorization === `Bearer ${sharedToken}`
}

function sendJson(response: http.ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function acquireLease() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::integer) AS acquired',
    [advisoryLockKey],
  )
  if (!result.rows[0]?.acquired) {
    await client.end()
    throw new Error('Another PeakUI WorkSpaces daemon already owns the runtime lease.')
  }
  lockClient = client
}

function recordTickError(scope: 'workspace dispatch' | 'automation', error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  updateAutomationWorkerSnapshot({ lastError: message })
  console.error(`[workspace-daemon] ${scope} failed:`, message)
}

function tick() {
  if (stopping) return
  // Interactive dispatch only claims a bounded batch and detaches model work.
  // Keep it independent from potentially slower monitor/schedule polling.
  if (!workspaceDispatchRunning) {
    workspaceDispatchRunning = true
    void processQueuedWorkspaceAgentRuns()
      .then(() => updateAutomationWorkerSnapshot({ lastError: null }))
      .catch(error => recordTickError('workspace dispatch', error))
      .finally(() => { workspaceDispatchRunning = false })
  }
  if (!automationTickRunning) {
    automationTickRunning = true
    void runAutomationTick()
      .then(() => updateAutomationWorkerSnapshot({ lastError: null }))
      .catch(error => recordTickError('automation', error))
      .finally(() => { automationTickRunning = false })
  }
}

function startServer() {
  server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (url.pathname === '/health' && request.method === 'GET') {
      return sendJson(response, 200, { status: 'ok', service: 'peakui-workspace-daemon' })
    }
    if (url.pathname === '/status' && request.method === 'GET') {
      if (!authorized(request)) return sendJson(response, 401, { error: 'Unauthorized' })
      return sendJson(response, 200, {
        ...getAutomationWorkerSnapshot(),
        service: 'peakui-workspace-daemon',
        intervalMs,
        workspaceDispatchRunning,
        automationTickRunning,
      })
    }
    return sendJson(response, 404, { error: 'Not found' })
  })
  server.listen(port, bindHost, () => {
    console.info(`[workspace-daemon] listening on ${bindHost}:${port}`)
  })
}

async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  if (tickTimer) clearInterval(tickTimer)
  updateAutomationWorkerSnapshot({ running: false })
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve())
  await lockClient?.end().catch(() => undefined)
  lockClient = null
  console.info(`[workspace-daemon] stopped (${signal})`)
  process.exit(0)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WORKSPACE_DAEMON_PORT is invalid')
  await acquireLease()
  updateAutomationWorkerSnapshot({
    running: true,
    startedAt: new Date().toISOString(),
    lastError: null,
  })
  startServer()
  tick()
  tickTimer = setInterval(tick, intervalMs)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

main().catch(error => {
  console.error('[workspace-daemon] startup failed:', error)
  process.exit(1)
})
