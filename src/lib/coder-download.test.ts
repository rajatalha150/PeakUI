import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hostPathForWorkspaceFile,
  hostRootForWorkspaceFile,
  sanitizeDownloadFilename,
  streamDaemonFileWindowed,
  streamGuestDownload,
  streamLocalDownload,
} from './coder-download'

const mocks = vi.hoisted(() => ({ proxyToCoderDaemon: vi.fn() }))
vi.mock('@/lib/coder-gateway', () => ({
  proxyToCoderDaemon: mocks.proxyToCoderDaemon,
  getCoderDaemonBaseUrl: () => 'http://coder.test',
  getCoderDaemonToken: () => 'test-token',
}))

describe('hostPathForWorkspaceFile', () => {
  it('maps a /workspace file onto the app mount', () => {
    expect(hostPathForWorkspaceFile('/workspace/inventory-agent/app-release.apk')).toBe('/coder-workspace/inventory-agent/app-release.apk')
  })

  it('maps the workspace root itself', () => {
    expect(hostPathForWorkspaceFile('/workspace')).toBe('/coder-workspace')
  })

  it('maps an /apps file onto the apps mount', () => {
    expect(hostPathForWorkspaceFile('/apps/foo/bar')).toBe('/coder-apps/foo/bar')
  })

  it('maps the /apps root itself', () => {
    expect(hostPathForWorkspaceFile('/apps')).toBe('/coder-apps')
  })

  it('returns null for a path outside any mapped root', () => {
    expect(hostPathForWorkspaceFile('/etc/passwd')).toBeNull()
  })

  it('disables direct host paths when the backend owns its filesystem', () => {
    process.env.CODER_SHARED_VOLUMES = 'false'
    try {
      expect(hostPathForWorkspaceFile('/workspace/large.zip')).toBeNull()
      expect(hostRootForWorkspaceFile('/apps')).toBeNull()
    } finally {
      delete process.env.CODER_SHARED_VOLUMES
    }
  })
})

describe('sanitizeDownloadFilename', () => {
  it('strips quotes, backslashes, and control characters', () => {
    expect(sanitizeDownloadFilename('a"b\\c\r\nd\x01')).toBe('a_b_c__d_')
  })

  it('falls back to a default for an empty name', () => {
    expect(sanitizeDownloadFilename('')).toBe('download')
  })
})

describe('streamLocalDownload', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'peakui-dl-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('streams the full file with content-length and disposition', async () => {
    const content = Buffer.from('hello world '.repeat(100))
    const file = join(dir, 'artifact.bin')
    await writeFile(file, content)
    const res = await streamLocalDownload(file, dir, 'artifact.bin')
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Content-Length')).toBe(String(content.length))
    expect(res.headers.get('Content-Disposition')).toContain('artifact.bin')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(content)).toBe(true)
  })

  it('throws when the target is not a regular file', async () => {
    await expect(streamLocalDownload(join(dir, 'missing.bin'), dir, 'missing.bin')).rejects.toThrow()
  })

  it('rejects a workspace symlink that resolves outside its volume', async () => {
    const outside = join(tmpdir(), `peakui-secret-${Date.now()}`)
    await writeFile(outside, 'not workspace data')
    await symlink(outside, join(dir, 'escape'))
    await expect(streamLocalDownload(join(dir, 'escape'), dir, 'escape')).rejects.toThrow('outside the workspace')
    await rm(outside, { force: true })
  })
})

describe('streamDaemonFileWindowed', () => {
  beforeEach(() => { mocks.proxyToCoderDaemon.mockReset() })

  it('reassembles a file across truncated windows', async () => {
    const a = Buffer.from('AAAA'), b = Buffer.from('BBBB'), c = Buffer.from('CC')
    mocks.proxyToCoderDaemon
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ contentBase64: a.toString('base64'), truncated: true, returnedBytes: a.length }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ contentBase64: b.toString('base64'), truncated: true, returnedBytes: b.length }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ contentBase64: c.toString('base64'), truncated: false, returnedBytes: c.length }) })
    const out = Buffer.from(await streamDaemonFileWindowed('/apps/foo.bin', 'foo.bin').arrayBuffer())
    expect(out.toString()).toBe('AAAABBBBCC')
    expect(mocks.proxyToCoderDaemon).toHaveBeenCalledTimes(3)
    // Each window requests the daemon's 256 KiB ceiling and advances the offset.
    expect(mocks.proxyToCoderDaemon.mock.calls[0][0]).toContain('maxBytes=262144')
    expect(mocks.proxyToCoderDaemon.mock.calls[0][0]).toContain('offset=0')
    expect(mocks.proxyToCoderDaemon.mock.calls[1][0]).toContain('offset=4')
    expect(mocks.proxyToCoderDaemon.mock.calls[2][0]).toContain('offset=8')
  })

  it('throws on a non-2xx daemon response', async () => {
    mocks.proxyToCoderDaemon.mockResolvedValueOnce({ status: 404, body: '{"error":"not found"}' })
    await expect(streamDaemonFileWindowed('/apps/foo.bin', 'foo.bin').arrayBuffer()).rejects.toThrow()
  })

  it('rejects a truncated response that makes no progress', async () => {
    mocks.proxyToCoderDaemon.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ contentBase64: '', truncated: true, returnedBytes: 0, sizeBytes: 10 }),
    })
    await expect(streamDaemonFileWindowed('/apps/foo.bin', 'foo.bin').arrayBuffer()).rejects.toThrow('before the file was complete')
  })

  it('rejects a daemon chunk whose declared and decoded sizes disagree', async () => {
    mocks.proxyToCoderDaemon.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ contentBase64: Buffer.from('data').toString('base64'), truncated: false, returnedBytes: 3 }),
    })
    await expect(streamDaemonFileWindowed('/apps/foo.bin', 'foo.bin').arrayBuffer()).rejects.toThrow('invalid file chunk length')
  })

  it('runs cleanup after the streamed body closes', async () => {
    const cleanup = vi.fn()
    mocks.proxyToCoderDaemon.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ contentBase64: Buffer.from('data').toString('base64'), truncated: false, returnedBytes: 4, sizeBytes: 4 }),
    })
    await streamDaemonFileWindowed('/apps/foo.bin', 'foo.bin', 'application/octet-stream', cleanup).arrayBuffer()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})

describe('streamGuestDownload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('passes a large file stream through without buffering it', async () => {
    const upstream = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() },
    }), { headers: { 'Content-Length': '3' } })
    const buffered = vi.spyOn(upstream, 'arrayBuffer')
    const fetchMock = vi.fn().mockResolvedValue(upstream)
    vi.stubGlobal('fetch', fetchMock)
    const response = await streamGuestDownload('/workspace', ['/workspace/build.apk'], false)
    expect(response.headers.get('Content-Disposition')).toContain('build.apk')
    expect(response.headers.get('Content-Length')).toBe('3')
    expect(fetchMock.mock.calls[0][0]).toContain('/peakui/files/stream?')
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
    expect(buffered).not.toHaveBeenCalled()
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
  })

  it('streams an archive request with all selected paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PK'))
    vi.stubGlobal('fetch', fetchMock)
    const response = await streamGuestDownload('/workspace', ['/workspace/a', '/workspace/b'], true)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toContain('peakui-download.zip')
    expect(fetchMock.mock.calls[0][0]).toBe('http://coder.test/peakui/files/archive')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      workspace: '/workspace', paths: ['/workspace/a', '/workspace/b'],
    })
  })

  it('reports guest errors before starting the browser download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"File not found."}', { status: 404 })))
    await expect(streamGuestDownload('/workspace', ['/workspace/missing'], false)).rejects.toThrow('File not found.')
  })
})
