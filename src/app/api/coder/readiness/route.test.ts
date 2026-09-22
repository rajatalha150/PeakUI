import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCurrentAuthWithPermissions: vi.fn(),
  prismaQueryRaw: vi.fn(),
  getCoderDaemonBaseUrl: vi.fn(),
  getCoderDaemonToken: vi.fn(),
}))

vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: mocks.prismaQueryRaw },
}))

vi.mock('@/lib/coder-gateway', () => ({
  getCoderDaemonBaseUrl: mocks.getCoderDaemonBaseUrl,
  getCoderDaemonToken: mocks.getCoderDaemonToken,
}))

async function loadRoute() {
  return await import('./route')
}

beforeEach(() => {
  mocks.requireCurrentAuthWithPermissions.mockReset()
  mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
    auth: { user: { id: 'user-1', role: 'ADMIN' }, permissions: ['workspace-tool.use'] },
    userId: 'user-1',
  })
  mocks.prismaQueryRaw.mockReset()
  mocks.prismaQueryRaw.mockResolvedValue([{ '?column?': 1 }])
  mocks.getCoderDaemonBaseUrl.mockReset().mockReturnValue('http://127.0.0.1:4170')
  mocks.getCoderDaemonToken.mockReset().mockReturnValue('')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/coder/readiness', () => {
  it('reports ready when DB and daemon are both reachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }))
    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; checks: Record<string, { ok: boolean }> }
    expect(body.ok).toBe(true)
    expect(body.checks.db.ok).toBe(true)
    expect(body.checks.daemon.ok).toBe(true)
  })

  it('returns 503 when the daemon is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'))
    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; checks: Record<string, { ok: boolean }> }
    expect(body.ok).toBe(false)
    expect(body.checks.daemon.ok).toBe(false)
  })

  it('returns 503 when the DB is unreachable', async () => {
    mocks.prismaQueryRaw.mockRejectedValue(new Error('ECONNREFUSED'))
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; checks: Record<string, { ok: boolean }> }
    expect(body.checks.db.ok).toBe(false)
  })

  it('denies an unauthenticated caller', async () => {
    mocks.requireCurrentAuthWithPermissions.mockResolvedValue({ response: new Response('forbidden', { status: 403 }) })
    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('does not call an arbitrary 200 page a healthy daemon', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>wrong service</html>'))
    const { GET } = await loadRoute()
    expect((await GET()).status).toBe(503)
  })
})
