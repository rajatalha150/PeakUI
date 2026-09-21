import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forwardableRequestHeaders, getCoderDaemonBaseUrl, getCoderDaemonToken, proxyToCoderDaemon } from './coder-gateway'

/**
 * The gateway is the only path from the browser to the coding brain, and the
 * bug it used to have was a hand-maintained route whitelist that silently
 * 404'd the endpoints the UI depends on. These cover the pieces that are easy
 * to regress: daemon URL/token resolution, header injection, and the promise
 * that a daemon outage surfaces as a typed 502 rather than an exception.
 */
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.CODER_DAEMON_URL
  delete process.env.CODER_SERVER_TOKEN
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('getCoderDaemonBaseUrl', () => {
  it('defaults to loopback on the daemon port', () => {
    expect(getCoderDaemonBaseUrl()).toBe('http://127.0.0.1:4170')
  })

  it('honours an override and strips trailing slashes so paths cannot double up', () => {
    process.env.CODER_DAEMON_URL = 'http://coder.internal:4170///'
    expect(getCoderDaemonBaseUrl()).toBe('http://coder.internal:4170')
  })

  it('falls back when the override is blank', () => {
    process.env.CODER_DAEMON_URL = '   '
    expect(getCoderDaemonBaseUrl()).toBe('http://127.0.0.1:4170')
  })
})

describe('getCoderDaemonToken', () => {
  it('is empty on loopback (the daemon needs no bearer there)', () => {
    expect(getCoderDaemonToken()).toBe('')
  })

  it('trims a configured token', () => {
    process.env.CODER_SERVER_TOKEN = '  secret-token  '
    expect(getCoderDaemonToken()).toBe('secret-token')
  })
})

describe('forwardableRequestHeaders', () => {
  it('forwards the SSE resume cursor so the daemon can replay from it', () => {
    const headers = new Headers({
      'x-qwen-client-id': 'client-9',
      'last-event-id': '42',
      'x-qwen-event-epoch': '7',
    })
    expect(forwardableRequestHeaders(headers)).toEqual({
      'x-qwen-client-id': 'client-9',
      'last-event-id': '42',
      'x-qwen-event-epoch': '7',
    })
  })

  it('omits resume headers the browser did not send', () => {
    expect(forwardableRequestHeaders(new Headers())).toEqual({})
  })
})

describe('proxyToCoderDaemon', () => {
  it('attaches the bearer token server-side and never leaks it to the caller', async () => {
    process.env.CODER_SERVER_TOKEN = 'secret-token'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await proxyToCoderDaemon('/health', { method: 'GET' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:4170/health')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-token' })
    // The token must not end up in anything the route hands back.
    expect(result.body).not.toContain('secret-token')
    expect(JSON.stringify(result.headers)).not.toContain('secret-token')
  })

  it('omits the Authorization header when no token is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await proxyToCoderDaemon('/health')

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization')
  })

  it('serialises a body only when one was supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await proxyToCoderDaemon('/session', { method: 'POST', body: { cwd: '/workspace' } })
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ cwd: '/workspace' }))

    fetchMock.mockClear()
    await proxyToCoderDaemon('/session/x/cancel', { method: 'POST' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeUndefined()
  })

  it('passes the daemon status through verbatim, including 4xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'gone' }), { status: 404, headers: { 'content-type': 'application/json' } }),
    ))

    const result = await proxyToCoderDaemon('/session/stale/status')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(JSON.parse(result.body)).toEqual({ error: 'gone' })
  })

  it('turns a transport failure into a typed 502 instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await proxyToCoderDaemon('/health')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(502)
    const parsed = JSON.parse(result.body)
    expect(parsed.code).toBe('coder_daemon_unreachable')
    expect(parsed.detail).toContain('ECONNREFUSED')
  })

  it('relays the SSE identity headers the browser client needs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-qwen-client-id': 'client-42',
          'x-qwen-event-epoch': 'epoch-7',
        },
      }),
    ))

    const result = await proxyToCoderDaemon('/session/x/status')
    expect(result.headers).toMatchObject({
      'x-qwen-client-id': 'client-42',
      'x-qwen-event-epoch': 'epoch-7',
    })
  })
})
