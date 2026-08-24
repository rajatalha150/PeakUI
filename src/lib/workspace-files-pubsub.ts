// In-process pub/sub for workspace-file mutations.
//
// The /api/workspace-tool/workspaces/[id]/files mutation routes call publish()
// after every successful disk write. The /api/workspace-tool/workspaces/[id]/events
// SSE endpoint subscribes() and forwards events to connected clients.
//
// This is intentionally single-process. If PeakUI ever runs multiple Node
// processes behind a load balancer, swap this for Redis pub/sub or a
// Postgres LISTEN/NOTIFY channel — the publish/subscribe API surface
// stays the same.

import type { WorkspaceEvent } from './workspace-files-types'

type Subscriber = (event: WorkspaceEvent) => void

const subscribersByWorkspace = new Map<string, Set<Subscriber>>()

function key(workspaceId: string): string {
  return workspaceId
}

export function publishWorkspaceEvent(workspaceId: string, event: WorkspaceEvent): void {
  const subs = subscribersByWorkspace.get(key(workspaceId))
  if (!subs || subs.size === 0) return
  for (const sub of subs) {
    try {
      sub(event)
    } catch {
      // A misbehaving subscriber must not block delivery to the others.
    }
  }
}

export function subscribeWorkspaceEvents(workspaceId: string, subscriber: Subscriber): () => void {
  const subs = subscribersByWorkspace.get(key(workspaceId)) ?? new Set<Subscriber>()
  subs.add(subscriber)
  subscribersByWorkspace.set(key(workspaceId), subs)
  return () => {
    const current = subscribersByWorkspace.get(key(workspaceId))
    if (!current) return
    current.delete(subscriber)
    if (current.size === 0) {
      subscribersByWorkspace.delete(key(workspaceId))
    }
  }
}

export function getWorkspaceSubscriberCount(workspaceId: string): number {
  return subscribersByWorkspace.get(key(workspaceId))?.size ?? 0
}