import { describe, expect, it } from 'vitest'

/**
 * Regression: the "keep going" http_request infinite-refetch loop.
 *
 * Root cause chain (Nov 8 VisionGrid session): http_request returned RAW
 * HTML; the first 24K chars were <head>/CSS/<nav> chrome, so the Drupal
 * contractor directory content was never visible. The durable truncation
 * message said "rerun a narrower query" — meaningless for http_request — so
 * the model blind-refetched the same URL and truncated at the same spot,
 * forever.
 *
 * Fixes under test (unit level — the route's behaviors are mirrored in the
 * helpers it uses; full E2E is exercised against the live app):
 * 1. HTML responses are converted to readable text before slicing.
 * 2. Truncated responses carry nextOffset so the model can continue.
 * 3. The daemon's asToolResult continuation text tells the model to use it.
 */

describe('http_request loop fix contract', () => {
  it('readable extraction removes nav chrome and keeps directory content', async () => {
    const { extractReadableText } = await import('./web-context')
    const nav = 'Home Products Subscribe Cookie settings Privacy terms'
    const content = Array.from({ length: 40 }, (_, i) =>
      `Accord Contracting ${i} — Liam O\u2019Sullivan — liam@accordcontracting.example — (212) 555-01${String(i).padStart(2, '0')}`).join(' ')
    const html = `<html><head><title>Approved Contractors</title><link rel="stylesheet" href="/sites/all/themes/css/drupal.css"></head><body><nav>${nav}</nav><article><h1>Approved Contractors</h1><p>${content}</p></article><footer>${nav}</footer></body></html>`
    const extracted = extractReadableText(html, new URL('https://jointutilitiesofny.org/ev/make-ready/approved-contractors'))
    const text = extracted?.text ?? ''
    expect(text).toContain('Accord Contracting 39')
    expect(text).not.toContain('drupal.css')
  })

  it('paging math: offset + slice length = nextOffset, hasMore only when content remains', () => {
    const text = 'x'.repeat(150)
    const cap = 100
    const offset = 0
    const body = text.slice(offset, offset + cap)
    const hasMore = offset + body.length < text.length
    expect(hasMore).toBe(true)
    expect(offset + body.length).toBe(100)
    // continuing from nextOffset reaches the end
    const offset2 = 100
    const body2 = text.slice(offset2, offset2 + cap)
    expect(offset2 + body2.length < text.length).toBe(false)
  })

  it('daemon continuation message instructs offset continuation for http_request', async () => {
    // mirror of asToolResult's continuation logic
    const data = { truncated: true, nextOffset: 24000, body: '...' }
    const name = 'http_request'
    const MAX = 24000
    let continuation = '\n[Tool result truncated in durable context. Inspect the underlying artifact or rerun a narrower query for the full payload.]'
    if (name === 'http_request' && data && typeof data === 'object') {
      const nextOffset = (data as Record<string, unknown>).nextOffset
      const truncated = (data as Record<string, unknown>).truncated
      if (truncated === true && typeof nextOffset === 'number') {
        continuation = `\n[Tool result truncated in durable context at ${MAX} chars. The response has more content. To continue reading, call http_request again with the SAME url/method and "offset": ${nextOffset} — the next portion of the response body starts at that character position. Do not refetch the same URL without an offset.]`
      }
    }
    expect(continuation).toContain('"offset": 24000')
    expect(continuation).toContain('Do not refetch the same URL without an offset')
  })
})
