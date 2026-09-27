import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireCurrentAuthWithPermissions: vi.fn() }))

vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

async function loadRoute() {
  return await import('./route')
}

beforeEach(() => {
  mocks.requireCurrentAuthWithPermissions.mockReset()
  mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
    auth: { user: { id: 'admin-1', role: 'ADMIN' }, permissions: ['workspace-tool.use'] },
    userId: 'admin-1',
  })
})

afterEach(() => vi.restoreAllMocks())

describe('LXD preview proxy', () => {
  it('proxies through the private guest bridge and rewrites root-relative HTML assets', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<html><head></head><body><script src="/assets/app.js"></script><a href="/login">Sign in</a></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    ))
    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://peakui.test/api/coder/preview-proxy/8081/dashboard?tab=1'),
      { params: Promise.resolve({ target: '8081', path: ['dashboard'] }) },
    )

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://p8081.localhost:4172/dashboard?tab=1',
      expect.objectContaining({ method: 'GET' }),
    )
    const html = await response.text()
    expect(html).toContain('<base href="/api/coder/preview-proxy/8081/">')
    expect(html).toContain('src="/api/coder/preview-proxy/8081/assets/app.js"')
    expect(html).toContain('href="/api/coder/preview-proxy/8081/login"')
  })

  it('rejects invalid or reserved guest ports before opening a connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { GET } = await loadRoute()
    const response = await GET(
      new NextRequest('http://peakui.test/api/coder/preview-proxy/4172/'),
      { params: Promise.resolve({ target: '4172' }) },
    )
    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
