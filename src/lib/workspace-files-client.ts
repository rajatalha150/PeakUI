// Typed browser-side client for the Workspace Files API.
//
// All methods throw on non-2xx responses with a structured WorkspaceFilesError
// the UI can surface. They NEVER swallow permission errors — those need to be
// visible to the user so they can grant the workspace-tool.filesystem permission.

import type {
  WorkspaceDeleteResponse,
  WorkspaceEvent,
  WorkspaceFileContent,
  WorkspaceFileMutationRequest,
  WorkspaceFileMutationResponse,
  WorkspaceRenameRequest,
  WorkspaceTreeResponse,
  WorkspaceUploadResponse,
} from './workspace-files-types'

export interface WorkspaceFilesError extends Error {
  code: string
  status: number
  actionRequired?: string
  /**
   * Server-computed ETag for the resource at the time the response was
   * generated. Populated on 412 conflict responses so the editor can
   * auto-reload the on-server version into the editor buffer.
   */
  currentEtag?: string
}

function makeError(status: number, body: { error?: string; code?: string; actionRequired?: string; currentEtag?: string }): WorkspaceFilesError {
  const err = new Error(body.error ?? `Request failed with status ${status}`) as WorkspaceFilesError
  err.name = 'WorkspaceFilesError'
  err.status = status
  err.code = body.code ?? 'internal'
  if (body.actionRequired) err.actionRequired = body.actionRequired
  if (body.currentEtag) err.currentEtag = body.currentEtag
  return err
}

async function parseError(response: Response): Promise<WorkspaceFilesError> {
  let body: { error?: string; code?: string; actionRequired?: string; currentEtag?: string } = {}
  try {
    body = await response.json() as typeof body
  } catch {
    // body was not JSON — fall through with empty body
  }
  return makeError(response.status, body)
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await parseError(response)
  return (await response.json()) as T
}

export interface ListTreeOptions {
  /** Path relative to workspace root. Empty string or "/" means the root. */
  path?: string
  /** How many directory levels to recurse. Defaults to 1 (just the directory itself). */
  depth?: number
}

export async function listWorkspaceTree(workspaceId: string, options: ListTreeOptions = {}): Promise<WorkspaceTreeResponse> {
  const params = new URLSearchParams()
  if (options.path) params.set('path', options.path)
  if (typeof options.depth === 'number') params.set('depth', String(options.depth))
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files${params.toString() ? `?${params}` : ''}`
  return readJson<WorkspaceTreeResponse>(await fetch(url, { credentials: 'same-origin' }))
}

export async function readWorkspaceFile(workspaceId: string, path: string, ifMatch?: string): Promise<WorkspaceFileContent> {
  const params = new URLSearchParams({ path })
  const headers: Record<string, string> = {}
  if (ifMatch) headers['If-Match'] = ifMatch
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files/raw?${params}`
  const response = await fetch(url, { credentials: 'same-origin', headers })
  if (response.status === 412) {
    let body: { currentEtag?: string } = {}
    try { body = (await response.json()) as typeof body } catch { /* ignore */ }
    throw makeError(412, { code: 'conflict', error: 'File changed on server', currentEtag: body.currentEtag })
  }
  return readJson<WorkspaceFileContent>(response)
}

export async function writeWorkspaceFile(
  workspaceId: string,
  request: WorkspaceFileMutationRequest,
  ifMatch?: string
): Promise<WorkspaceFileMutationResponse> {
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ifMatch) headers['If-Match'] = ifMatch
  return readJson(await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(request),
  }))
}

export async function renameWorkspacePath(
  workspaceId: string,
  request: WorkspaceRenameRequest
): Promise<{ from: string; to: string }> {
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files`
  return readJson(await fetch(url, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }))
}

export async function deleteWorkspacePath(
  workspaceId: string,
  path: string,
  recursive = false
): Promise<WorkspaceDeleteResponse> {
  const params = new URLSearchParams({ path })
  if (recursive) params.set('recursive', 'true')
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files?${params}`
  return readJson(await fetch(url, { method: 'DELETE', credentials: 'same-origin' }))
}

export interface UploadFileInput {
  /** Path relative to workspace root where the file will land. */
  path: string
  file: File
}

export async function uploadWorkspaceFiles(workspaceId: string, files: UploadFileInput[]): Promise<WorkspaceUploadResponse> {
  const form = new FormData()
  form.set('paths', JSON.stringify(files.map(f => f.path)))
  for (const { file } of files) {
    form.append('files', file)
  }
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files/upload`
  return readJson(await fetch(url, { method: 'POST', credentials: 'same-origin', body: form }))
}

/**
 * Streams a zip of the requested paths via fetch. Returns the Response so the
 * caller can pipe it to a download. The browser-friendly shortcut is
 * downloadWorkspaceZipBlob() below.
 */
export async function downloadWorkspaceZip(workspaceId: string, paths: string[]): Promise<Response> {
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files/zip`
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
  if (!response.ok) throw await parseError(response)
  return response
}

export async function downloadWorkspaceZipBlob(workspaceId: string, paths: string[]): Promise<Blob> {
  const response = await downloadWorkspaceZip(workspaceId, paths)
  return response.blob()
}

export async function downloadWorkspaceFile(workspaceId: string, path: string): Promise<Response> {
  const params = new URLSearchParams({ path })
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/files/download?${params}`
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw await parseError(response)
  return response
}

/**
 * Opens a Server-Sent Events stream to /events for the workspace. Returns an
 * AbortController so the caller can close the connection on unmount. Each
 * parsed WorkspaceEvent is forwarded to onEvent.
 *
 * Reconnect: a transient fetch failure or stream-end schedules a reconnect
 * with jittered exponential backoff (500ms → 5s). The loop terminates when
 * the caller's AbortController fires. Each successful fetch (one that yields
 * parsed events) resets the backoff so a long-lived stream stays long-lived.
 */
export function subscribeWorkspaceEvents(
  workspaceId: string,
  onEvent: (event: WorkspaceEvent) => void,
  onError?: (error: Event) => void
): AbortController {
  const controller = new AbortController()
  const url = `/api/workspace-tool/workspaces/${encodeURIComponent(workspaceId)}/events`

  // Backoff bounds. The first reconnect waits 500ms; each subsequent failure
  // doubles the wait up to 5s. A successful read (one that parsed at least
  // one event) resets the wait back to the minimum.
  const MIN_BACKOFF_MS = 500
  const MAX_BACKOFF_MS = 5_000
  let backoff = MIN_BACKOFF_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const scheduleReconnect = () => {
    if (stopped || controller.signal.aborted) return
    const jitter = Math.floor(Math.random() * 250)
    const delay = Math.min(MAX_BACKOFF_MS, backoff) + jitter
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void runOnce()
    }, delay)
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2)
  }

  const runOnce = async (): Promise<void> => {
    if (stopped || controller.signal.aborted) return
    let receivedAny = false
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        if (onError) onError(new Event('error'))
        scheduleReconnect()
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const dataLine = chunk
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('\n')
          if (dataLine) {
            try {
              const event = JSON.parse(dataLine) as WorkspaceEvent
              onEvent(event)
              receivedAny = true
            } catch {
              // Malformed event — skip rather than crash the stream.
            }
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
      // Stream ended cleanly (server closed). Treat as a transient blip and
      // reconnect — unless the caller aborted.
      if (controller.signal.aborted || stopped) return
      scheduleReconnect()
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return
      if (onError) onError(error as Event)
      scheduleReconnect()
    } finally {
      // A successful read resets the backoff so future failures don't carry
      // accumulated delay.
      if (receivedAny) backoff = MIN_BACKOFF_MS
    }
  }

  controller.signal.addEventListener('abort', () => {
    stopped = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }, { once: true })

  void runOnce()
  return controller
}