// Server-Sent Events wire-format helpers for the workspace-files event stream.
//
// Spec reference: https://html.spec.whatwg.org/multipage/server-sent-events.html
//
// Encoding rules we follow:
//   - Each SSE message is one or more `field: value\n` lines terminated by a
//     blank line (`\n\n`). We always emit a single `data:` field whose value
//     is the JSON stringified event.
//   - Keepalive frames are SSE comments: a line starting with `:` followed by
//     arbitrary text. Comments are ignored by EventSource clients, so they
//     can be sent at any time to keep proxies from idling the connection.
//   - The decoder side splits on `\n\n` and treats any line starting with
//     `data:` (after trimming) as a payload fragment, joining multiple
//     fragments with `\n` per the spec.

import type { WorkspaceEvent } from './workspace-files-types'

/** The wire-format bytes for a single SSE event. Includes the trailing `\n\n`. */
export function encodeWorkspaceEvent(event: WorkspaceEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

/** A keepalive SSE comment. No data; just a heartbeat frame. */
export const KEEPALIVE_BYTES: Uint8Array = new TextEncoder().encode(`: keepalive\n\n`)

/**
 * Parse a chunk of SSE bytes into zero or more parsed events. Bytes that do
 * not yet contain a complete `\n\n`-terminated message remain buffered.
 *
 * This is the inverse of `encodeWorkspaceEvent` and matches the consumer logic
 * in `workspace-files-client.ts`.
 */
export function parseWorkspaceEventChunk(
  buffer: string,
  chunk: string
): { events: WorkspaceEvent[]; remainder: string } {
  const combined = buffer + chunk
  const events: WorkspaceEvent[] = []
  let boundary = combined.indexOf('\n\n')
  let cursor = 0
  while (boundary !== -1) {
    const message = combined.slice(cursor, boundary)
    cursor = boundary + 2
    const dataLine = message
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n')
    if (dataLine) {
      try {
        events.push(JSON.parse(dataLine) as WorkspaceEvent)
      } catch {
        // Skip malformed payloads; the stream stays open.
      }
    }
    boundary = combined.indexOf('\n\n', cursor)
  }
  return { events, remainder: combined.slice(cursor) }
}