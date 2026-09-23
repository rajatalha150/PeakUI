import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hostPathForWorkspaceFile,
  readDaemonFileWindowed,
  sanitizeDownloadFilename,
  streamLocalDownload,
} from './coder-download'

const mocks = vi.hoisted(() => ({ proxyToCoderDaemon: vi.fn() }))
vi.mock('@/lib/coder-gateway', () => ({ proxyToCoderDaemon: mocks.proxyToCoderDaemon }))

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
    const res = await streamLocalDownload(file, 'artifact.bin')
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Content-Length')).toBe(String(content.length))
    expect(res.headers.get('Content-Disposition')).toContain('artifact.bin')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(content)).toBe(true)
  })

  it('throws when the target is not a regular file', async () => {
    await expect(streamLocalDownload(join(dir, 'missing.bin'), 'missing.bin')).rejects.toThrow()
  })
})

describe('readDaemonFileWindowed', () => {
  beforeEach(() => { mocks.proxyToCoderDaemon.mockReset() })

  it('reassembles a file across truncated windows', async () => {
    const a = Buffer.from('AAAA'), b = Buffer.from('BBBB'), c = Buffer.from('CC')
    mocks.proxyToCoderDaemon
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ contentBase64: a.toString('base64'), truncated: true, returnedBytes: a.length }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ contentBase64: b.toString('base64'), truncated: true, returnedBytes: b.length }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ contentBase64: c.toString('base64'), truncated: false, returnedBytes: c.length }) })
    const out = await readDaemonFileWindowed('/apps/foo.bin')
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
    await expect(readDaemonFileWindowed('/apps/foo.bin')).rejects.toThrow()
  })
})
