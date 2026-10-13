import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), bound: vi.fn() }))
vi.mock('@/lib/coder-access', () => ({ requireCoderAccess: mocks.access }))
vi.mock('@/lib/coder-authorization', () => ({
  bindCoderSessionWorkspace: mocks.bound,
  normalizeCoderWorkspacePath: (value: string) => value.startsWith('/workspace') ? value : null,
}))
vi.mock('@/lib/coder-gateway', () => ({ getCoderDaemonBaseUrl: () => 'http://guest:4170', getCoderDaemonToken: () => 'private-token' }))
import { POST } from './route'

const sessionId = '12345678-1234-1234-1234-123456789abc'
function upload(name = 'report.pdf') {
  return new NextRequest('http://localhost/api/coder/attachments', {
    method: 'POST',
    headers: {
      'x-peakui-session-id': sessionId,
      'x-peakui-workspace': '/workspace/project',
      'x-peakui-filename': encodeURIComponent(name),
    },
    body: new Uint8Array([1, 2, 3]),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockResolvedValue({ userId: 'alice' })
  mocks.bound.mockResolvedValue(true)
})

it('rejects a session outside the user workspace before forwarding bytes', async () => {
  mocks.bound.mockResolvedValue(false)
  const forwarded = vi.spyOn(globalThis, 'fetch')
  expect((await POST(upload())).status).toBe(404)
  expect(forwarded).not.toHaveBeenCalled()
  forwarded.mockRestore()
})

it('streams bytes to the authenticated guest session', async () => {
  const forwarded = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"path":"/workspace/project/file"}', { status: 201 }))
  const response = await POST(upload('résumé.pdf'))
  expect(response.status).toBe(201)
  expect(mocks.bound).toHaveBeenCalledWith('alice', sessionId, '/workspace/project')
  const [url, init] = forwarded.mock.calls[0]
  expect(url).toBe(`http://guest:4170/session/${sessionId}/attachment`)
  expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer private-token', 'x-peakui-filename': encodeURIComponent('résumé.pdf') })
  expect(new Uint8Array(await new Response((init as RequestInit).body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  forwarded.mockRestore()
})
