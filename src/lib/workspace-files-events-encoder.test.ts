// Tests for the SSE encoder/parser helpers in workspace-files-events-encoder.ts.
// Run with `npx vitest run src/lib/workspace-files-events-encoder.test.ts`.

import { describe, expect, it } from 'vitest'
import {
  encodeWorkspaceEvent,
  KEEPALIVE_BYTES,
  parseWorkspaceEventChunk,
} from './workspace-files-events-encoder'
import type { WorkspaceEvent } from './workspace-files-types'

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

describe('encodeWorkspaceEvent', () => {
  it('serializes an event as a single `data:` frame terminated by a blank line', () => {
    const event: WorkspaceEvent = { kind: 'file.modified', path: 'skills/x.md', at: 1700000000000 }
    const bytes = encodeWorkspaceEvent(event)
    const text = decode(bytes)
    expect(text).toBe('data: {"kind":"file.modified","path":"skills/x.md","at":1700000000000}\n\n')
  })

  it('handles events without a path hint', () => {
    const event: WorkspaceEvent = { kind: 'tree.invalidated', at: 42 }
    const bytes = encodeWorkspaceEvent(event)
    expect(decode(bytes)).toBe('data: {"kind":"tree.invalidated","at":42}\n\n')
  })

  it('produces UTF-8 bytes that round-trip through JSON.parse', () => {
    const event: WorkspaceEvent = { kind: 'file.created', path: 'résumé/café.md', at: 1 }
    const bytes = encodeWorkspaceEvent(event)
    const payload = decode(bytes).slice('data: '.length, -2)
    const parsed = JSON.parse(payload) as WorkspaceEvent
    expect(parsed.path).toBe('résumé/café.md')
  })
})

describe('KEEPALIVE_BYTES', () => {
  it('is a valid SSE comment frame (`: keepalive\\n\\n`)', () => {
    expect(decode(KEEPALIVE_BYTES)).toBe(': keepalive\n\n')
  })
})

describe('parseWorkspaceEventChunk', () => {
  it('parses a single complete event from one chunk', () => {
    const event: WorkspaceEvent = { kind: 'file.deleted', path: 'a/b', at: 7 }
    const chunk = decode(encodeWorkspaceEvent(event))
    const { events, remainder } = parseWorkspaceEventChunk('', chunk)
    expect(events).toEqual([event])
    expect(remainder).toBe('')
  })

  it('buffers a partial event across two chunks', () => {
    const event: WorkspaceEvent = { kind: 'tree.invalidated', at: 1 }
    const full = decode(encodeWorkspaceEvent(event))
    const split = 7
    const { events: e1, remainder: r1 } = parseWorkspaceEventChunk('', full.slice(0, split))
    expect(e1).toEqual([])
    expect(r1).toBe(full.slice(0, split))
    const { events: e2, remainder: r2 } = parseWorkspaceEventChunk(r1, full.slice(split))
    expect(e2).toEqual([event])
    expect(r2).toBe('')
  })

  it('skips malformed payloads and continues', () => {
    const good: WorkspaceEvent = { kind: 'file.modified', path: 'x', at: 2 }
    const chunk = `data: not-json\n\n${decode(encodeWorkspaceEvent(good))}`
    const { events, remainder } = parseWorkspaceEventChunk('', chunk)
    expect(events).toEqual([good])
    expect(remainder).toBe('')
  })

  it('skips SSE comments (`: keepalive`) without yielding events', () => {
    const chunk = decode(KEEPALIVE_BYTES)
    const { events, remainder } = parseWorkspaceEventChunk('', chunk)
    expect(events).toEqual([])
    expect(remainder).toBe('')
  })

  it('parses multiple events in one chunk', () => {
    const a: WorkspaceEvent = { kind: 'file.created', path: 'a', at: 1 }
    const b: WorkspaceEvent = { kind: 'file.modified', path: 'b', at: 2 }
    const c: WorkspaceEvent = { kind: 'file.deleted', path: 'c', at: 3 }
    const chunk = [a, b, c].map(e => decode(encodeWorkspaceEvent(e))).join('')
    const { events, remainder } = parseWorkspaceEventChunk('', chunk)
    expect(events).toEqual([a, b, c])
    expect(remainder).toBe('')
  })
})