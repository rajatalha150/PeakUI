import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { authorizeCoderSession } from '@/lib/coder-authorization'

/**
 * Regression cover for the gateway route's response relay.
 *
 * The bug: `POST /session/:id/cancel` was a 404 (the route was a hand-written
 * whitelist), and once the route existed it returned a 500 — the daemon answers
 * cancel with `204 No Content`, and the relay passed the daemon's empty-string
 * body straight to `Response`, which throws for a body on a 204/205/304.
 *
 * A 204 that survives the proxy is the observable contract here: the Coding UI
 * calls cancel to stop a runaway local-model turn, so a failure there means an
 * unstoppable agent.
 */
const ORIGINAL_ENV = { ...process.env }

const mocks = vi.hoisted(() => ({
  requireCurrentAuthWithPermissions: vi.fn(),
}))

// The route imports the auth helper, which reaches for Prisma/request state that
// this test has no interest in; stub the module boundary instead.
vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

// `authorizeCoderSession` hits Prisma; keep the pure helpers real and stub only
// the DB lookup so ownership checks pass without a database.
vi.mock('@/lib/coder-authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/coder-authorization')>()
  return { ...actual, authorizeCoderSession: vi.fn().mockResolvedValue(true) }
})

async function loadRoute() {
  return await import('./route')
}

function makeRequest(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(`http://localhost:3000/api/coder${path}`, init as never)
}

beforeEach(() => {
  delete process.env.CODER_DAEMON_URL
  delete process.env.CODER_SERVER_TOKEN
  mocks.requireCurrentAuthWithPermissions.mockReset()
  mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
    userId: 'user-1',
    auth: { user: { role: 'USER' } },
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('coder gateway route — response relay', () => {
  it('relays a daemon 204 without throwing and without attaching a body', async () => {
    // This is exactly what `POST /session/:id/cancel` returns upstream.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    const { POST } = await loadRoute()

    const res = await POST(makeRequest('/session/abc/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as never)

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('survives an empty-bodied 204 on every verb the UI uses', async () => {
    const { GET, DELETE, PATCH } = await loadRoute()

    for (const [name, call] of [
      ['GET', () => GET(makeRequest('/session/abc/status') as never)],
      ['DELETE', () => DELETE(makeRequest('/session/abc', { method: 'DELETE' }) as never)],
      ['PATCH', () => PATCH(makeRequest('/session/abc', { method: 'PATCH', body: '{}' }) as never)],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
      const res = await call()
      expect(res.status, `${name} should relay 204`).toBe(204)
      expect(await res.text(), `${name} should have no body`).toBe('')
    }
  })

  it('forwards a JSON error body and status verbatim', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'stale session' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    const { GET } = await loadRoute()

    const res = await GET(makeRequest('/session/stale/status') as never)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'stale session' })
  })

  it('proxies the status, approval-mode and workspace routes the UI depends on', async () => {
    // Guards the whitelist regression: these were 404s before the route became
    // a passthrough, which silently broke the live status pill and approval UI.
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url).replace('http://127.0.0.1:4170', ''))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const { GET, POST } = await loadRoute()

    await GET(makeRequest('/session/abc/status') as never)
    await POST(makeRequest('/session/abc/approval-mode', { method: 'POST', body: JSON.stringify({ mode: 'yolo' }) }) as never)
    await GET(makeRequest('/workspace/tools?workspace=%2Fworkspace') as never)
    await GET(makeRequest('/workspace/models?workspace=%2Fworkspace') as never)

    expect(seen).toEqual([
      '/session/abc/status',
      '/session/abc/approval-mode',
      '/workspace/tools?workspace=%2Fworkspace',
      '/workspace/models?workspace=%2Fworkspace',
    ])
  })

  it('proxies the reversible-work (rewind) routes the UI depends on', async () => {
    // Guards the Phase 5 rewind exposure: list snapshots (GET) and rewind to a
    // snapshot (POST) must reach the daemon through the pass-through, with the
    // rewind body forwarded intact.
    const seen: Array<{ url: string; body?: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url).replace('http://127.0.0.1:4170', ''), body: init?.body })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const { GET, POST } = await loadRoute()

    await GET(makeRequest('/session/abc/rewind/snapshots') as never)
    await POST(makeRequest('/session/abc/rewind', {
      method: 'POST',
      body: JSON.stringify({ promptId: 'abc########1', rewindFiles: true }),
    }) as never)

    expect(seen.map(s => s.url)).toEqual([
      '/session/abc/rewind/snapshots',
      '/session/abc/rewind',
    ])
    // The rewind body is forwarded so `promptId` reaches the daemon verbatim.
    expect(JSON.parse(seen[1].body as string)).toEqual({ promptId: 'abc########1', rewindFiles: true })
  })

  it('denies a rewind against a session the caller does not own', async () => {
    vi.mocked(authorizeCoderSession).mockResolvedValue(false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { GET } = await loadRoute()

    const res = await GET(makeRequest('/session/foreign/rewind/snapshots') as never)
    expect(res.status).toBe(404)
  })

  it('proxies a workspace file read with a canonical path', async () => {
    let proxied = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      proxied = String(url).replace('http://127.0.0.1:4170', '')
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const { GET } = await loadRoute()

    await GET(makeRequest('/file?path=%2Fworkspace%2Fsrc%2Fa.ts') as never)
    expect(proxied).toBe('/file?path=%2Fworkspace%2Fsrc%2Fa.ts')
  })

  it('rejects a file operation with a traversal path before forwarding', async () => {
    let called = false
    vi.stubGlobal('fetch', vi.fn(async () => { called = true; return new Response('{}', { status: 200 }) }))
    const { GET, POST } = await loadRoute()

    const read = await GET(makeRequest('/file?path=..%2F..%2Fetc%2Fpasswd') as never)
    expect(read.status).toBe(400)

    const write = await POST(makeRequest('/file/write', {
      method: 'POST',
      body: JSON.stringify({ path: '../../etc/passwd', content: 'x', mode: 'replace' }),
    }) as never)
    expect(write.status).toBe(400)

    const missing = await POST(makeRequest('/file/write', {
      method: 'POST',
      body: JSON.stringify({ content: 'x', mode: 'replace' }),
    }) as never)
    expect(missing.status).toBe(400)

    expect(called).toBe(false)
  })
})
