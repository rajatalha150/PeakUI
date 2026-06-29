import { describe, expect, it } from 'vitest'
import {
  getWorkspaceSubscriberCount,
  publishWorkspaceEvent,
  subscribeWorkspaceEvents,
} from './workspace-files-pubsub'

describe('workspace-files-pubsub', () => {
  it('delivers events to subscribers of the same workspace', () => {
    const received: string[] = []
    const unsubscribe = subscribeWorkspaceEvents('ws-1', event => {
      received.push(`${event.kind}:${event.path ?? ''}`)
    })

    publishWorkspaceEvent('ws-1', { kind: 'file.created', path: 'a.txt', at: 1 })
    publishWorkspaceEvent('ws-1', { kind: 'file.modified', path: 'b.txt', at: 2 })

    expect(received).toEqual(['file.created:a.txt', 'file.modified:b.txt'])
    unsubscribe()
  })

  it('does not leak events across workspaces', () => {
    const a: string[] = []
    const b: string[] = []
    const unsubA = subscribeWorkspaceEvents('ws-a', e => a.push(e.kind))
    const unsubB = subscribeWorkspaceEvents('ws-b', e => b.push(e.kind))

    publishWorkspaceEvent('ws-a', { kind: 'tree.invalidated', at: 1 })
    publishWorkspaceEvent('ws-b', { kind: 'file.deleted', path: 'x', at: 2 })

    expect(a).toEqual(['tree.invalidated'])
    expect(b).toEqual(['file.deleted'])
    unsubA()
    unsubB()
  })

  it('unsubscribe stops further delivery', () => {
    const received: string[] = []
    const unsubscribe = subscribeWorkspaceEvents('ws-2', e => received.push(e.kind))
    publishWorkspaceEvent('ws-2', { kind: 'file.created', at: 1 })
    unsubscribe()
    publishWorkspaceEvent('ws-2', { kind: 'file.modified', at: 2 })
    expect(received).toEqual(['file.created'])
  })

  it('tracks subscriber count', () => {
    expect(getWorkspaceSubscriberCount('ws-empty')).toBe(0)
    const u1 = subscribeWorkspaceEvents('ws-empty', () => {})
    expect(getWorkspaceSubscriberCount('ws-empty')).toBe(1)
    const u2 = subscribeWorkspaceEvents('ws-empty', () => {})
    expect(getWorkspaceSubscriberCount('ws-empty')).toBe(2)
    u1()
    u2()
    expect(getWorkspaceSubscriberCount('ws-empty')).toBe(0)
  })

  it('isolates a throwing subscriber from the others', () => {
    const ok: string[] = []
    subscribeWorkspaceEvents('ws-throw', () => {
      throw new Error('boom')
    })
    const unsubscribe = subscribeWorkspaceEvents('ws-throw', e => ok.push(e.kind))

    expect(() => publishWorkspaceEvent('ws-throw', { kind: 'tree.invalidated', at: 1 })).not.toThrow()
    expect(ok).toEqual(['tree.invalidated'])
    unsubscribe()
  })
})