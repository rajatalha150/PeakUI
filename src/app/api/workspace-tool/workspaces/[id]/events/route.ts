import { NextRequest } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { getWorkspaceToolWorkspaceById } from '@/lib/workspace-tool-project-workspaces'
import {
  getWorkspaceSubscriberCount,
  subscribeWorkspaceEvents,
} from '@/lib/workspace-files-pubsub'
import {
  KEEPALIVE_BYTES,
  encodeWorkspaceEvent,
} from '@/lib/workspace-files-events-encoder'
import type { WorkspaceEvent } from '@/lib/workspace-files-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REQUIRED_PERMISSIONS = ['workspace-tool.use', 'workspace-tool.filesystem'] as const
const KEEPALIVE_INTERVAL_MS = 25_000

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Server-Sent Events stream for one workspace's file mutations.
 *
 * Subscribes to the in-process pub/sub (workspace-files-pubsub.ts) and pushes
 * every `WorkspaceEvent` to the client as a `data: …\n\n` frame. A keepalive
 * SSE comment is sent every 25s so reverse proxies (nginx, cloudflare) do not
 * idle the connection.
 *
 * Auth: same gate as the file mutation routes — must have `workspace-tool.use` AND
 * `workspace-tool.filesystem`, and the workspace must exist for the current user.
 *
 * Cleanup: subscriber is unsubscribed on request abort AND on stream cancel,
 * whichever fires first. We track via a single boolean so the unsubscribe
 * path is idempotent.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext,
) {
  const access = await requireCurrentAuthWithPermissions([...REQUIRED_PERMISSIONS], {
    forbiddenMessage: 'Workspace Files permission is not granted for this account.',
  })
  if ('response' in access) return access.response

  const { id: workspaceId } = await ctx.params
  const workspace = await getWorkspaceToolWorkspaceById(access.userId, workspaceId)
  if (!workspace) {
    return new Response(
      JSON.stringify({ error: 'Workspace not found', code: 'not_found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let unsubscribe: (() => void) | null = null
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (bytes: Uint8Array) => {
        try {
          controller.enqueue(bytes)
        } catch {
          // The stream has been closed underneath us. Tear everything down so
          // we don't leak the timer or the subscriber.
          cleanup()
        }
      }

      const cleanup = () => {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer)
          keepaliveTimer = null
        }
        if (unsubscribe) {
          unsubscribe()
          unsubscribe = null
        }
        try {
          controller.close()
        } catch {
          // Already closed — ignore.
        }
      }

      unsubscribe = subscribeWorkspaceEvents(workspace.id, (event: WorkspaceEvent) => {
        safeEnqueue(encodeWorkspaceEvent(event))
      })

      // Initial keepalive so the client sees the stream open immediately
      // (some EventSource implementations wait for the first byte before
      // firing `open`).
      safeEnqueue(KEEPALIVE_BYTES)

      keepaliveTimer = setInterval(() => {
        safeEnqueue(KEEPALIVE_BYTES)
      }, KEEPALIVE_INTERVAL_MS)

      const onAbort = () => cleanup()
      if (request.signal.aborted) {
        cleanup()
      } else {
        request.signal.addEventListener('abort', onAbort, { once: true })
      }
    },
    cancel() {
      // EventSource closed the stream. Tear down timer + subscriber.
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer)
        keepaliveTimer = null
      }
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Connection': 'keep-alive',
      // Disable nginx response buffering — otherwise the proxy will hold
      // bytes until the response is "complete", which it never is.
      'X-Accel-Buffering': 'no',
    },
  })
}

// Force the route to be treated as dynamic so Next.js does not try to cache
// the streamed response.
export const fetchCache = 'force-no-store'

// Touch the helper so it isn't flagged as unused on builds that strip unused
// imports for a particular route entry — `getWorkspaceSubscriberCount` is the
// pub/sub's own introspection API and may be wired into diagnostics later.
void getWorkspaceSubscriberCount