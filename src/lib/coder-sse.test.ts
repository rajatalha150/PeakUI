import { describe, expect, it } from 'vitest'
import { createSseParser } from './coder-sse'

function collect(...chunks: string[]) {
  const frames: Array<{ id?: string; data: string }> = []
  const parser = createSseParser(f => frames.push({ ...(f.id ? { id: f.id } : {}), data: f.data }))
  for (const chunk of chunks) parser.push(chunk)
  return frames
}

describe('createSseParser', () => {
  it('parses a single frame with an id and data', () => {
    expect(collect('id: 12\ndata: {"type":"x"}\n\n')).toEqual([
      { id: '12', data: '{"type":"x"}' },
    ])
  })

  it('parses a frame with no id (synthetic terminal frame)', () => {
    expect(collect('data: {"type":"turn_complete"}\n\n')).toEqual([
      { data: '{"type":"turn_complete"}' },
    ])
  })

  it('splits a frame across chunk boundaries', () => {
    expect(collect('id: 3\nda', 'ta: {"a":1}\n', '\n')).toEqual([
      { id: '3', data: '{"a":1}' },
    ])
  })

  it('parses multiple frames in one chunk', () => {
    expect(collect('id: 1\ndata: a\n\nid: 2\ndata: b\n\n')).toEqual([
      { id: '1', data: 'a' },
      { id: '2', data: 'b' },
    ])
  })

  it('ignores comment/heartbeat frames and keeps partial frames buffered', () => {
    expect(collect(': heartbeat\n\nid: 9\ndata: hi\n\n')).toEqual([
      { id: '9', data: 'hi' },
    ])
    // A trailing frame without its blank-line terminator is held back.
    expect(collect('id: 9\ndata: partial')).toEqual([])
  })

  it('joins multi-line data fields with a newline', () => {
    expect(collect('data: line1\ndata: line2\n\n')).toEqual([{ data: 'line1\nline2' }])
  })

  it('matches the daemon LF framing (id line carries a trailing space)', () => {
    expect(collect('id: 7 \ndata: {"type":"tool_call"}\n\n')).toEqual([
      { id: '7', data: '{"type":"tool_call"}' },
    ])
  })
})
