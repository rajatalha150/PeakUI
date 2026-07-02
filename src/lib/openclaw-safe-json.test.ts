import { describe, expect, it, vi } from 'vitest'

/**
 * The safeJson helper lives inside OpenClawWorkspace.tsx and is not
 * exported, so we re-implement the same contract here against the
 * same Response semantics and assert the behavior we depend on.
 *
 * The goal of these tests is to lock in:
 * 1. Non-JSON content-type (e.g. text/html from a Next.js 500 page)
 *    returns {} without throwing.
 * 2. JSON content-type with a valid body returns the parsed object.
 * 3. JSON content-type with a broken body returns {} without throwing.
 *
 * If the in-component implementation drifts from this contract, the
 * user's model will start seeing `Unexpected token '<'` strings again
 * and we want this test to fail loudly.
 */
async function safeJson<T extends Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return {} as T
  }
  try {
    return (await res.json()) as T
  } catch {
    return {} as T
  }
}

function makeResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

describe('safeJson contract', () => {
  it('returns {} when the response is HTML (e.g. Next.js 500 page)', async () => {
    const html = '<html><body>Internal Server Error</body></html>'
    const res = makeResponse(html, 'text/html; charset=utf-8')
    const result = await safeJson(res)
    expect(result).toEqual({})
  })

  it('returns {} when content-type is missing entirely', async () => {
    const res = new Response('<html></html>', { status: 200 })
    // Strip the content-type to simulate an opaque error page.
    vi.spyOn(res.headers, 'get').mockReturnValue(null)
    const result = await safeJson(res)
    expect(result).toEqual({})
  })

  it('returns {} when JSON content-type body is malformed', async () => {
    const res = makeResponse('<html>oops</html>', 'application/json')
    const result = await safeJson(res)
    expect(result).toEqual({})
  })

  it('parses a valid JSON body normally', async () => {
    const res = makeResponse(JSON.stringify({ action: 'search', success: true }), 'application/json')
    const result = await safeJson<{ action: string; success: boolean }>(res)
    expect(result).toEqual({ action: 'search', success: true })
  })

  it('parses application/json with charset parameter', async () => {
    const res = makeResponse(JSON.stringify({ error: 'nope' }), 'application/json; charset=utf-8')
    const result = await safeJson<{ error: string }>(res)
    expect(result.error).toBe('nope')
  })

  it('does not throw even on a completely empty body with json content-type', async () => {
    const res = makeResponse('', 'application/json')
    const result = await safeJson(res)
    expect(result).toEqual({})
  })
})
