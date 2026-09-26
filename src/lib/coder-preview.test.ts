import { describe, expect, it } from 'vitest'
import { parsePreviewUrl } from './coder-preview'

describe('parsePreviewUrl', () => {
  it('accepts a loopback dev-server URL', () => {
    expect(parsePreviewUrl('http://localhost:8000/')).toEqual({
      target: { host: 'localhost', port: 8000, path: '/' },
    })
    expect(parsePreviewUrl('http://127.0.0.1:5173/app')).toEqual({
      target: { host: '127.0.0.1', port: 5173, path: '/app' },
    })
  })

  it('rejects the app, daemon, DB, SearXNG, tor and executor ports', () => {
    for (const port of [3000, 3001, 4170, 4318, 5432, 8080, 9050, 9150]) {
      const r = parsePreviewUrl(`http://127.0.0.1:${port}/`)
      expect(r, `port ${port}`).toHaveProperty('error')
    }
  })

  it('rejects non-loopback hosts and non-http schemes', () => {
    expect(parsePreviewUrl('http://example.com:8000/')).toHaveProperty('error')
    expect(parsePreviewUrl('http://192.168.1.5:8000/')).toHaveProperty('error')
    expect(parsePreviewUrl('file:///etc/passwd')).toHaveProperty('error')
    expect(parsePreviewUrl('javascript:alert(1)')).toHaveProperty('error')
  })

  it('rejects missing, privileged, and non-numeric ports', () => {
    expect(parsePreviewUrl('http://localhost/')).toHaveProperty('error')
    expect(parsePreviewUrl('http://localhost:80/')).toHaveProperty('error')
    expect(parsePreviewUrl('http://localhost:notaport/')).toHaveProperty('error')
  })

  it('accepts an LXD preview origin without exposing host reserved ports', () => {
    expect(parsePreviewUrl('http://p3000.localhost:4172/app')).toEqual({ target: { host: 'p3000.localhost', port: 4172, path: '/app' } })
    expect(parsePreviewUrl('http://p4170.localhost:4172/')).toHaveProperty('error')
    expect(parsePreviewUrl('http://127.0.0.1:3000/', { allowGuestPorts: true })).toHaveProperty('target')
  })

  it('rejects malformed input', () => {
    expect(parsePreviewUrl('not a url')).toHaveProperty('error')
    expect(parsePreviewUrl('')).toHaveProperty('error')
  })
})
