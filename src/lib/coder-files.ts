/**
 * Workspace-file contract for the Coding surface's project explorer.
 *
 * The daemon exposes workspace-scoped file routes (all keyed by an absolute
 * `path`, resolved against its registered/trusted workspaces):
 *
 *   - `GET  /list?path=<dir>`      → `{ kind:"list", path, entries, truncated }`
 *   - `GET  /file?path=<file>`     → `{ kind:"file", path, content, hash, … }`
 *   - `POST /file/write`           → `{ kind:"file_write", path, created, hash, … }`
 *
 * Writes are compare-and-swap: `mode:"replace"` requires the current content
 * `hash` from a prior read so the editor cannot clobber a concurrent agent edit.
 *
 * This module owns the *pure* parsing/validation of those payloads. The daemon
 * is a separate process behind the gateway, so its responses are untrusted —
 * a malformed list or file read is rejected before the UI renders it or a
 * `hash` is echoed back as a write precondition.
 */

export type FileEntryKind = 'file' | 'directory'

/** One directory entry from `GET /list`. */
export interface FileEntry {
  name: string
  kind: FileEntryKind
  ignored: boolean
}

/** A parsed directory listing. */
export interface FileList {
  /** Path the daemon reports, relative to the workspace root. */
  path: string
  entries: FileEntry[]
  truncated: boolean
}

/** A parsed text-file read. */
export interface FileContent {
  content: string
  /** Content hash — present when the file was read in full (not truncated). */
  hash: string | null
  sizeBytes: number
  truncated: boolean
}

/** A parsed write result (used to refresh the editor buffer's hash). */
export interface FileWriteResult {
  created: boolean
  hash: string
  sizeBytes: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEntry(value: unknown): FileEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string' || value.name.length === 0) return null
  if (value.name === '.' || value.name === '..' || /[\/\\\x00-\x1f]/.test(value.name)) return null
  const kind = value.kind === 'directory' ? 'directory' : value.kind === 'file' ? 'file' : null
  if (!kind) return null
  return { name: value.name, kind, ignored: value.ignored === true }
}

/** A save acknowledges the submitted text, not edits typed while it was pending. */
export function reconcileFileSave<T extends { content: string; hash: string | null; dirty: boolean }>(
  current: T, submittedContent: string, hash: string,
): T {
  return { ...current, hash, dirty: current.content !== submittedContent }
}

/** Parse a `GET /list` payload. */
export function parseFileList(data: unknown): { list: FileList } | { error: string } {
  if (!isRecord(data) || !Array.isArray(data.entries)) {
    return { error: 'Directory listing response is malformed.' }
  }
  const entries: FileEntry[] = []
  for (const raw of data.entries) {
    const entry = parseEntry(raw)
    if (!entry) return { error: 'Directory listing contains an invalid entry.' }
    entries.push(entry)
  }
  return {
    list: {
      path: typeof data.path === 'string' ? data.path : '.',
      entries,
      truncated: data.truncated === true,
    },
  }
}

/** Parse a `GET /file` payload. */
export function parseFileContent(data: unknown): { file: FileContent } | { error: string } {
  if (!isRecord(data)) return { error: 'File read response is malformed.' }
  if (typeof data.content !== 'string') return { error: 'File read response is missing content.' }
  return {
    file: {
      content: data.content,
      hash: typeof data.hash === 'string' && data.hash.length > 0 ? data.hash : null,
      sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : new TextEncoder().encode(data.content).byteLength,
      truncated: data.truncated === true,
    },
  }
}

/** Parse a `POST /file/write` payload. */
export function parseFileWriteResult(data: unknown): { result: FileWriteResult } | { error: string } {
  if (!isRecord(data)) return { error: 'File write response is malformed.' }
  if (typeof data.hash !== 'string' || data.hash.length === 0) {
    return { error: 'File write response is missing the new hash.' }
  }
  return {
    result: {
      created: data.created === true,
      hash: data.hash,
      sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    },
  }
}
