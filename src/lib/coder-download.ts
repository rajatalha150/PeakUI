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

import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
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

/** Return the app-side shared-volume root for a daemon path, if it has one. */
export function hostRootForWorkspaceFile(daemonPath: string): string | null {
  for (const [daemonRoot, hostRoot] of HOST_WORKSPACE_ROOTS) {
    if (daemonPath === daemonRoot || daemonPath.startsWith(`${daemonRoot}/`)) return resolve(hostRoot)
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

/**
 * Resolve a path through symlinks and require that its final target remains in
 * the mounted workspace. A lexical path check alone would let a workspace
 * symlink expose files from elsewhere in the app container.
 */
async function verifiedLocalFile(hostPath: string, hostRoot: string): Promise<{ handle: FileHandle; size: number }> {
  const [resolvedPath, resolvedRoot] = await Promise.all([realpath(hostPath), realpath(hostRoot)])
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error('Download target resolves outside the workspace.')
  }
  // The path was resolved above, but open the final component without following
  // a symlink so it cannot be swapped after validation and before streaming.
  const handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Download target is not a file.')
    return { handle, size: info.size }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Stream a verified local file without buffering it in the app process. */
export async function streamLocalDownload(
  hostPath: string,
  hostRoot: string,
  filename: string,
  contentType = 'application/octet-stream',
  onClose?: () => void,
): Promise<Response> {
  const file = await verifiedLocalFile(hostPath, hostRoot)
  const source = file.handle.createReadStream()
  if (onClose) source.once('close', onClose)
  const webStream = Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>
  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(filename)}"`,
    },
  })
}

/**
 * Stream a file from the daemon in validated 256 KiB windows. Unlike the old
 * reassembly path this never accumulates the complete file in memory.
 */
export function streamDaemonFileWindowed(
  daemonPath: string,
  filename: string,
  contentType = 'application/octet-stream',
  onClose?: () => void,
): Response {
  const source = Readable.from((async function* () {
  let offset = 0
  let sizeBytes: number | undefined
  for (;;) {
    const query = `path=${encodeURIComponent(daemonPath)}&offset=${offset}&maxBytes=${FILE_BYTES_MAX}`
    const result = await proxyToCoderDaemon(`/file/bytes?${query}`, { method: 'GET' })
    if (result.status < 200 || result.status >= 300) {
      throw new Error(result.body || 'Could not read file')
    }
    let payload: {
      contentBase64?: string
      truncated?: boolean
      returnedBytes?: number
      sizeBytes?: number
    }
    try {
      payload = JSON.parse(result.body) as typeof payload
    } catch {
      throw new Error('Coder returned an invalid file-download response.')
    }
    if (typeof payload.contentBase64 !== 'string') throw new Error('Coder returned an invalid file chunk.')
    const chunk = Buffer.from(payload.contentBase64, 'base64')
    const returned = payload.returnedBytes ?? chunk.length
    if (!Number.isSafeInteger(returned) || returned < 0 || returned !== chunk.length) {
      throw new Error('Coder returned an invalid file chunk length.')
    }
    if (payload.sizeBytes !== undefined && (!Number.isSafeInteger(payload.sizeBytes) || payload.sizeBytes < 0)) {
      throw new Error('Coder returned an invalid file size.')
    }
    sizeBytes = payload.sizeBytes ?? sizeBytes
    offset += returned
    if (sizeBytes !== undefined && offset > sizeBytes) throw new Error('Coder returned more bytes than expected.')
    if (!payload.truncated) {
      if (sizeBytes !== undefined && offset !== sizeBytes) throw new Error('Coder download ended before the file was complete.')
      yield chunk
      return
    }
    if (returned === 0 || (sizeBytes !== undefined && offset >= sizeBytes)) {
      throw new Error('Coder download ended before the file was complete.')
    }
    yield chunk
  }
  })())
  if (onClose) source.once('close', onClose)
  return new Response(Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(filename)}"`,
    },
  })
}
