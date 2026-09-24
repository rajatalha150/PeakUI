import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { authorizeCoderSession, bindCoderSessionWorkspace } from '@/lib/coder-authorization'

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
  getUserSettings: vi.fn(),
  chatSessionFindFirst: vi.fn(),
}))

// The route imports the auth helper, which reaches for Prisma/request state that
// this test has no interest in; stub the module boundary instead.
vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

vi.mock('@/lib/settings', () => ({ getUserSettings: mocks.getUserSettings }))
vi.mock('@/lib/prisma', () => ({ prisma: { chatSession: { findFirst: mocks.chatSessionFindFirst } } }))

// `authorizeCoderSession` hits Prisma; keep the pure helpers real and stub only
// the DB lookup so ownership checks pass without a database.
vi.mock('@/lib/coder-authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/coder-authorization')>()
  return { ...actual, authorizeCoderSession: vi.fn().mockResolvedValue(true), bindCoderSessionWorkspace: vi.fn().mockResolvedValue(true) }
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
    auth: { user: { role: 'ADMIN' } },
  })
  vi.mocked(authorizeCoderSession).mockResolvedValue(true)
  vi.mocked(bindCoderSessionWorkspace).mockResolvedValue(true)
  mocks.getUserSettings.mockResolvedValue({ coderWorkspace: '/workspace', coderVisionModel: '', coderWriterModel: '' })
  mocks.chatSessionFindFirst.mockResolvedValue({ coderWorkspace: '/workspace' })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('coder gateway route — response relay', () => {
  it('denies non-admin access to all shared runtime surfaces before forwarding', async () => {
    mocks.requireCurrentAuthWithPermissions.mockResolvedValue({ userId: 'user-1', auth: { user: { role: 'USER' } } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET, POST } = await loadRoute()
    for (const path of ['/file?path=%2Fworkspace%2Fsecret', '/workspaces', '/workspaces/%2Fworkspace/sessions', '/workspace/settings', '/session/abc/status']) {
      expect((await GET(makeRequest(path))).status).toBe(403)
    }
    expect((await POST(makeRequest('/session', { method: 'POST', body: '{}' }))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cross-origin mutations even for an administrator', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()
    expect((await POST(makeRequest('/session/abc/shell', { method: 'POST', headers: { origin: 'https://untrusted.example' }, body: '{}' }))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires an owned session and binds its workspace before daemon creation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await loadRoute()
    for (const body of [{}, { cwd: '/workspace' }, { sessionId: null, cwd: '/workspace' }]) {
      expect((await POST(makeRequest('/session', { method: 'POST', body: JSON.stringify(body) }))).status).toBe(400)
    }
    vi.mocked(bindCoderSessionWorkspace).mockResolvedValue(false)
    expect((await POST(makeRequest('/session', { method: 'POST', body: JSON.stringify({ sessionId: 'abc', cwd: '/other' }) }))).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows workspace-scoped glob without a file path parameter', async () => {
    const fetchMock = vi.fn(async () => new Response('{"matches":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute()
    expect((await GET(makeRequest('/workspaces/%2Fapps/glob?pattern=**%2F*&maxResults=200'))).status).toBe(200)
    expect((await GET(makeRequest('/glob?pattern=**%2F*'))).status).toBe(200)
  })

  it('rejects an encoded session-path escape', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await loadRoute()
    expect((await GET(makeRequest('/session/abc%2F..%2Fforeign/status'))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
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

  it('reconciles vision and writer roles before every prompt, including blanks', async () => {
    const seen: string[] = []
    mocks.getUserSettings.mockResolvedValue({
      coderWorkspace: '/workspace',
      coderVisionModel: 'glm-vision:cloud',
      coderWriterModel: 'kimi-code:cloud',
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url).replace('http://127.0.0.1:4170', ''))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const { POST } = await loadRoute()

    expect((await POST(makeRequest('/session/abc/prompt', { method: 'POST', body: JSON.stringify({ prompt: 'hello' }) }) as never)).status).toBe(200)
    expect(seen).toEqual([
      '/workspace/settings?workspace=%2Fworkspace',
      '/workspace/agents/peakui-writer?scope=global',
      '/session/abc/prompt',
    ])
  })

  it('actively clears global delegates for a user with blank role settings', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url).replace('http://127.0.0.1:4170', ''))
      return new Response('{}', { status: seen.length === 2 ? 404 : 200, headers: { 'content-type': 'application/json' } })
    }))
    const { POST } = await loadRoute()

    expect((await POST(makeRequest('/session/abc/prompt', { method: 'POST', body: JSON.stringify({ prompt: 'hello' }) }) as never)).status).toBe(200)
    expect(seen).toEqual([
      '/workspace/settings?workspace=%2Fworkspace',
      '/workspace/agents/peakui-writer?scope=global',
      '/session/abc/prompt',
    ])
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
