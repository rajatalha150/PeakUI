import { getCurrentAuth } from '@/lib/request-auth'
import { getWorkspaceAgentRunEvents } from '@/lib/workspace-agent-run'

export const runtime = 'nodejs'
export const maxDuration = 900

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'waiting_approval'])

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentAuth()
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  const { id } = await context.params
  const url = new URL(req.url)
  let cursor = Math.max(0, Number(url.searchParams.get('after') || 0) || 0)
  const snapshot = await getWorkspaceAgentRunEvents(auth.user.id, id, cursor)
  if (!snapshot) return new Response(JSON.stringify({ error: 'Run not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const heartbeatTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify({ status: 'heartbeat', id, at: new Date().toISOString() })}\n`))
      }, 15_000)
      const close = () => { if (!closed) { closed = true; controller.close() } }
      const abort = () => close()
      req.signal.addEventListener('abort', abort, { once: true })
      try {
        if (cursor === 0 && (snapshot.run.status === 'queued' || snapshot.run.status === 'running')) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ status: snapshot.run.status === 'queued' ? 'connecting' : 'running', id })}\n`))
        }
        while (!closed) {
          const current = await getWorkspaceAgentRunEvents(auth.user.id, id, cursor)
          if (!current) break
          for (const event of current.events) {
            cursor = event.sequence
            controller.enqueue(encoder.encode(`${event.payload}\n`))
          }
          if (TERMINAL_STATUSES.has(current.run.status) && current.events.every(event => event.sequence <= cursor)) break
          await sleep(500)
        }
      } catch (error) {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify({ error: error instanceof Error ? error.message : 'WorkSpaces event stream failed' })}\n`))
      } finally {
        clearInterval(heartbeatTimer)
        req.signal.removeEventListener('abort', abort)
        close()
      }
    },
    cancel() {},
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
