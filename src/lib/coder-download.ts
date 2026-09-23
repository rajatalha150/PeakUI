/**
 * Large-file download support for the coder explorer.
 *
 * The daemon's `GET /file/bytes` reads at most `MAX_READ_BYTES` (256 KiB) per
 * request and defaults to 64 KiB when `maxBytes` is omitted — far too small for
 * build artifacts like an APK. For workspaces whose volume is also mounted in
 * the app container, we bypass the daemon entirely and stream the file straight
 * from the shared volume, so there is no per-request size ceiling at all. For
 * workspaces that are not mounted (an unknown future root), we fall back to
 * windowed daemon reads that reassemble the file in 256 KiB slices.
 */

import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { proxyToCoderDaemon } from '@/lib/coder-gateway'

/**
 * Daemon workspace roots the app container can read directly (shared volumes).
 * Each daemon root maps to the app side of the same named volume mounted into
 * both containers (`/workspace` → `/coder-workspace`, `/apps` → `/coder-apps`).
 */
const HOST_WORKSPACE_ROOTS: ReadonlyArray<readonly [string, string]> = [
  ['/workspace', process.env.CODER_WORKSPACE_HOST_ROOT || '/coder-workspace'],
  ['/apps', process.env.CODER_APPS_HOST_ROOT || '/coder-apps'],
]

/** The daemon's hard per-request read ceiling for `/file/bytes` (256 KiB). */
const FILE_BYTES_MAX = 256 * 1024

/**
 * Map a daemon workspace file path to the app's local mount, or `null` when the
 * workspace is not mounted (so the caller must use the windowed daemon read).
 * The returned path is re-checked to stay inside the host root as defense in
 * depth, though the caller is expected to have already validated the daemon path
 * via `normalizeCoderFilePath`.
 */
export function hostPathForWorkspaceFile(daemonPath: string): string | null {
  for (const [daemonRoot, hostRoot] of HOST_WORKSPACE_ROOTS) {
    if (daemonPath === daemonRoot) return resolve(hostRoot)
    if (!daemonPath.startsWith(`${daemonRoot}/`)) continue
    const target = resolve(hostRoot, `.${daemonPath.slice(daemonRoot.length)}`)
    const root = resolve(hostRoot)
    return target === root || target.startsWith(`${root}/`) ? target : null
  }
  return null
}

/** Strip characters that would break a `Content-Disposition` filename header. */
export function sanitizeDownloadFilename(name: string): string {
  return (
    name
      .replace(/["\\\r\n]/g, '_')
      .replace(/[\x00-\x1f\x7f]/g, '_')
      .slice(0, 255) || 'download'
  )
}

/** Stream a local file as an octet-stream attachment (supports large files). */
export async function streamLocalDownload(hostPath: string, filename: string): Promise<Response> {
  const info = await stat(hostPath)
  if (!info.isFile()) throw new Error('Download target is not a file.')
  const webStream = Readable.toWeb(createReadStream(hostPath)) as unknown as ReadableStream<Uint8Array>
  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(info.size),
      'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(filename)}"`,
    },
  })
}

/** Read a whole local file into memory (for the temporary ZIP archive). */
export async function readLocalFile(hostPath: string): Promise<Buffer> {
  return readFile(hostPath)
}

/**
 * Reassemble a file from the daemon's `GET /file/bytes` in 256 KiB windows.
 * Slower than a direct read but correct for workspaces the app cannot mount.
 */
export async function readDaemonFileWindowed(daemonPath: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  let offset = 0
  let sizeBytes: number | undefined
  for (;;) {
    const query = `path=${encodeURIComponent(daemonPath)}&offset=${offset}&maxBytes=${FILE_BYTES_MAX}`
    const result = await proxyToCoderDaemon(`/file/bytes?${query}`, { method: 'GET' })
    if (result.status < 200 || result.status >= 300) {
      throw new Error(result.body || 'Could not read file')
    }
    const payload = JSON.parse(result.body) as {
      contentBase64?: string
      truncated?: boolean
      returnedBytes?: number
      sizeBytes?: number
    }
    const chunk = payload.contentBase64 ? Buffer.from(payload.contentBase64, 'base64') : Buffer.alloc(0)
    const returned = payload.returnedBytes ?? chunk.length
    chunks.push(chunk)
    sizeBytes = payload.sizeBytes ?? sizeBytes
    offset += returned
    if (!payload.truncated) break
    if (returned <= 0) break
    if (sizeBytes !== undefined && offset >= sizeBytes) break
  }
  return Buffer.concat(chunks)
}
