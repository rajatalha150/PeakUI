import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireCurrentAuthWithPermissions: vi.fn(),
  capturePreviewScreenshot: vi.fn(),
}))

vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

vi.mock('@/lib/coder-preview-capture', () => ({
  PreviewCaptureError: class PreviewCaptureError extends Error {},
  capturePreviewScreenshot: mocks.capturePreviewScreenshot,
}))

async function loadRoute() {
  return await import('./route')
}

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/coder/preview/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as never)
}

beforeEach(() => {
  mocks.requireCurrentAuthWithPermissions.mockReset()
  mocks.capturePreviewScreenshot.mockReset()
  mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
    auth: { user: { id: 'admin-1', role: 'ADMIN' }, permissions: ['workspace-tool.use'] },
    userId: 'admin-1',
  })
})

afterEach(() => vi.restoreAllMocks())

describe('POST /api/coder/preview/screenshot', () => {
  it('captures the requested approved viewport', async () => {
    mocks.capturePreviewScreenshot.mockResolvedValue({ data: 'jpeg-data', mimeType: 'image/jpeg', width: 768, height: 1024 })
    const { POST } = await loadRoute()
    const res = await POST(request({ url: 'http://127.0.0.1:5173', device: 'tablet' }))
    expect(res.status).toBe(200)
    expect(mocks.capturePreviewScreenshot).toHaveBeenCalledWith({ url: 'http://127.0.0.1:5173', device: 'tablet' })
    expect(await res.json()).toMatchObject({ mimeType: 'image/jpeg', width: 768, height: 1024 })
  })

  it('rejects malformed requests before starting a browser', async () => {
    const { POST } = await loadRoute()
    expect((await POST(request({ url: 'http://127.0.0.1:5173', device: 'watch' }))).status).toBe(400)
    expect((await POST(request({ device: 'desktop' }))).status).toBe(400)
    expect(mocks.capturePreviewScreenshot).not.toHaveBeenCalled()
  })

  it('requires coder access', async () => {
    mocks.requireCurrentAuthWithPermissions.mockResolvedValue({ response: new Response('forbidden', { status: 403 }) })
    const { POST } = await loadRoute()
    expect((await POST(request({ url: 'http://127.0.0.1:5173', device: 'desktop' }))).status).toBe(403)
  })
})
