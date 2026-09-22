import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSseParser, streamSessionEvents } from './coder-sse'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function collect(...chunks: string[]) {
  const frames: Array<{ id?: string; data: string }> = []
  const parser = createSseParser(f => frames.push({ ...(f.id ? { id: f.id } : {}), data: f.data }))
  for (const chunk of chunks) parser.push(chunk)
  return frames
}

describe('createSseParser', () => {
  it('handles CRLF split between chunks and bare CR terminators', () => {
    expect(collect('id: 1\r', '\ndata: first\r', '\n\r', '\ndata: second\r\r')).toEqual([
      { id: '1', data: 'first' }, { data: 'second' },
    ])
  })

  it('bounds unterminated input', () => {
    expect(() => collect('data: ' + 'x'.repeat(2 * 1024 * 1024))).toThrow('buffer limit')
  })
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

describe('streamSessionEvents', () => {
  it('does not start an already-aborted subscription', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    streamSessionEvents('/events', () => {}, { signal: AbortSignal.abort() })()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops on expired authentication instead of retrying forever', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const close = streamSessionEvents('/events', () => {}, { onError })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(401)
    close()
  })

  it('resumes with cursor/epoch and clears an old cursor when the epoch changes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('id: 42\ndata: first\n\n', { headers: { 'x-qwen-event-epoch': 'one' } }))
      .mockResolvedValueOnce(new Response(': heartbeat\n\n', { headers: { 'x-qwen-event-epoch': 'two' } }))
      .mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const close = streamSessionEvents('/events', () => {})
    await vi.advanceTimersByTimeAsync(1600)
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'last-event-id': '42', 'x-qwen-event-epoch': 'one' })
    expect(fetchMock.mock.calls[2][1].headers).not.toHaveProperty('last-event-id')
    expect(fetchMock.mock.calls[2][1].headers['x-qwen-event-epoch']).toBe('two')
    close()
  })
})
