import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ access: vi.fn(), owned: vi.fn(), proxy: vi.fn() }))
vi.mock('@/lib/coder-access', () => ({ requireCoderAccess: mocks.access }))
vi.mock('@/lib/coder-authorization', () => ({ authorizeCoderSession: mocks.owned }))
vi.mock('@/lib/coder-gateway', () => ({ proxyToCoderDaemon: mocks.proxy }))
import { POST } from './route'
const request = (body: unknown) => new NextRequest('http://localhost/api/coder/browser', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockResolvedValue({ userId: 'alice' })
  mocks.owned.mockResolvedValue(true)
  mocks.proxy.mockResolvedValue({ status: 200, body: '{"data":"frame"}' })
})
it('rejects a foreign session without contacting the guest', async () => {
  mocks.owned.mockResolvedValue(false)
  expect((await POST(request({ sessionId: 'foreign', action: 'frame' }))).status).toBe(404)
  expect(mocks.proxy).not.toHaveBeenCalled()
})
it('uses a server-derived identity rather than a caller-supplied browser key', async () => {
  const response = await POST(request({ sessionId: 'session', key: 'victim', action: 'screenshot' }))
  expect(response.status).toBe(200)
  const body = mocks.proxy.mock.calls[0][1].body
  expect(body.key).toMatch(/^[a-f0-9]{64}$/)
  expect(body.key).not.toBe('victim')
  expect(response.headers.get('cache-control')).toBe('no-store')
})
it('keeps browser profiles separate for different users', async () => {
  await POST(request({ sessionId: 'session', action: 'frame' }))
  const alice = mocks.proxy.mock.calls[0][1].body.key
  mocks.access.mockResolvedValue({ userId: 'bob' })
  await POST(request({ sessionId: 'session', action: 'frame' }))
  expect(mocks.proxy.mock.calls[1][1].body.key).not.toBe(alice)
})
