import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireCurrentAuthWithPermissions: vi.fn(),
}))

vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

async function loadRoute() {
  return await import('./route')
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/coder/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  } as never)
}

beforeEach(() => {
  mocks.requireCurrentAuthWithPermissions.mockReset()
  mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
    auth: { user: { id: 'user-1' }, permissions: ['workspace-tool.use'] },
    userId: 'user-1',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/coder/preview', () => {
  it('accepts a safe loopback dev-server URL', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'http://127.0.0.1:5173/' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, target: { host: '127.0.0.1', port: 5173 } })
  })

  it('rejects a non-loopback URL (SSRF guard)', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'http://169.254.169.254/latest/meta-data' }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_preview_url')
  })

  it('rejects a reserved port', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'http://127.0.0.1:5432/' }))
    expect(res.status).toBe(400)
  })

  it('rejects a missing/empty URL', async () => {
    const { POST } = await loadRoute()
    expect((await POST(makeRequest({}))).status).toBe(400)
    expect((await POST(makeRequest({ url: '' }))).status).toBe(400)
  })

  it('rejects a non-JSON body', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest('not json'))
    expect(res.status).toBe(400)
  })

  it('denies an unauthenticated caller', async () => {
    mocks.requireCurrentAuthWithPermissions.mockResolvedValue({ response: new Response('forbidden', { status: 403 }) })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'http://127.0.0.1:5173/' }))
    expect(res.status).toBe(403)
  })
})
