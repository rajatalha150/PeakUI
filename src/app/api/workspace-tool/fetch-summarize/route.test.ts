import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalFetchAsReadableText = globalThis.fetch

// Mocks for module imports — these are set up via vi.mock and read
// by the route's imports.
const mocks = vi.hoisted(() => ({
  requireCurrentAuthWithPermissions: vi.fn(),
  fetchAsReadableText: vi.fn(),
}))

vi.mock('@/lib/request-auth', () => ({
  requireCurrentAuthWithPermissions: mocks.requireCurrentAuthWithPermissions,
}))

vi.mock('@/lib/web-fetch-strategy', () => ({
  fetchAsReadableText: mocks.fetchAsReadableText,
}))

function makeRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/workspace-tool/fetch-summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

beforeEach(() => {
  mocks.requireCurrentAuthWithPermissions.mockReset()
  mocks.fetchAsReadableText.mockReset()
  mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
    auth: { user: { id: 'user-1' } },
  })
})

afterEach(() => {
  globalThis.fetch = originalFetchAsReadableText
})

async function loadRoute() {
  return await import('./route')
}

describe('workspace-tool/fetch-summarize POST', () => {
  it('returns 400 when url is missing', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({}) as never)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('url is required')
  })

  it('returns 400 when url is empty string', async () => {
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: '   ' }) as never)
    expect(res.status).toBe(400)
  })

  it('returns 401-style when auth fails (delegated to requireCurrentAuthWithPermissions)', async () => {
    mocks.requireCurrentAuthWithPermissions.mockResolvedValue({
      response: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'https://example.com' }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 502 when fetchAsReadableText returns null', async () => {
    mocks.fetchAsReadableText.mockResolvedValue(null)
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'https://example.com' }) as never)
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('Could not fetch')
  })

  it('returns 200 with summary and quote on success', async () => {
    const longText = 'This is a detailed paragraph about a topic. ' + 'x'.repeat(80) + ' The text continues for a while. ' + 'y'.repeat(60)
    mocks.fetchAsReadableText.mockResolvedValue({
      title: 'Example Page',
      url: 'https://example.com/article',
      excerpt: longText,
      content: longText,
    })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'https://example.com/article' }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.title).toBe('Example Page')
    expect(Array.isArray(json.summary)).toBe(true)
    expect(json.summary.length).toBeLessThanOrEqual(5)
  })

  it('returns 504 (timeout) when fetch is aborted by the inner timeout', async () => {
    mocks.fetchAsReadableText.mockImplementation(async () => {
      // Simulate a fetch that throws an AbortError as the inner timeout
      // would. We don't actually wait 45s — we just throw the error
      // that AbortSignal.timeout() would throw.
      throw new DOMException('The operation was aborted', 'TimeoutError')
    })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'https://example.com/slow' }) as never)
    expect(res.status).toBe(504)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/timed out/i)
  })

  it('returns 504 (timeout) on AbortError too', async () => {
    mocks.fetchAsReadableText.mockImplementation(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'https://example.com/slow' }) as never)
    expect(res.status).toBe(504)
  })

  it('returns 500 for generic fetch errors', async () => {
    mocks.fetchAsReadableText.mockRejectedValue(new Error('network down'))
    const { POST } = await loadRoute()
    const res = await POST(makeRequest({ url: 'https://example.com' }) as never)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('network down')
  })

  it('passes the userId and a combined abort signal to fetchAsReadableText', async () => {
    mocks.fetchAsReadableText.mockResolvedValue({
      title: 'X',
      url: 'https://example.com',
      excerpt: 'x'.repeat(80),
      content: 'x'.repeat(80),
    })
    const { POST } = await loadRoute()
    await POST(makeRequest({ url: 'https://example.com' }) as never)
    expect(mocks.fetchAsReadableText).toHaveBeenCalledTimes(1)
    const call = mocks.fetchAsReadableText.mock.calls[0]
    const [url, options] = call as [string, { signal?: AbortSignal; userId?: string }]
    expect(url).toBe('https://example.com')
    expect(options.userId).toBe('user-1')
    expect(options.signal).toBeDefined()
    // The combined signal should be an AbortSignal instance.
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
})
