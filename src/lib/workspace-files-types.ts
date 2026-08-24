// Shared types for the Workspace Files panel.
//
// Path semantics: every "path" sent to or returned from the API is RELATIVE to
// the workspace root. The server resolves it against the workspace container
// path. Absolute paths, "../" escapes, and symlinks are all rejected by
// resolveReadableContainerPaths / resolveWritableContainerPaths in
// src/lib/workspace-tool-filesystem.ts before any disk access happens.

export type WorkspaceFileKind = 'file' | 'directory'

export interface WorkspaceFileEntry {
  name: string
  /** Path relative to the workspace root. Always uses forward slashes. */
  path: string
  kind: WorkspaceFileKind
  /** Bytes. Undefined for directories on platforms where dir size is expensive. */
  size?: number
  /** ISO 8601 timestamp. */
  modifiedAt?: string
  /** When kind === 'directory', the server has indicated children have been loaded. */
  loaded?: boolean
}

export interface WorkspaceTreeResponse {
  workspace: {
    id: string
    slug: string
    name: string
    /** Absolute container path on the server. */
    containerPath: string
    /** Absolute host path (where the bind mount points). */
    hostPath: string
  }
  /** The path (relative) that was listed. Empty string = root. */
  path: string
  entries: WorkspaceFileEntry[]
  /** True when the listing was truncated by the server-side cap. */
  truncated: boolean
}

export type WorkspaceFileEncoding = 'utf-8' | 'base64'

export interface WorkspaceFileContent {
  path: string
  encoding: WorkspaceFileEncoding
  /** utf-8 text or base64 bytes. */
  content: string
  size: number
  modifiedAt: string
  mimeType?: string
  /** Server-computed ETag, "size-mtime". Pass back as If-Match to detect concurrent edits. */
  etag: string
}

export interface WorkspaceFileMutationRequest {
  action: 'mkdir' | 'write'
  /** Path relative to workspace root. */
  path: string
  content?: string
  createDirectories?: boolean
}

export interface WorkspaceFileMutationResponse {
  entry: WorkspaceFileEntry
  /** New server-computed ETag after the write. Pass back as If-Match next time. */
  etag?: string
}

export interface WorkspaceRenameRequest {
  action: 'rename' | 'move'
  from: string
  to: string
}

export interface WorkspaceDeleteResponse {
  deleted: boolean
  path: string
}

export interface WorkspaceUploadResponse {
  uploaded: WorkspaceFileEntry[]
}

export type WorkspaceEventKind = 'tree.invalidated' | 'file.created' | 'file.modified' | 'file.deleted'

export interface WorkspaceEvent {
  kind: WorkspaceEventKind
  /** Optional path hint (relative to workspace root) the client can use to scope refetches. */
  path?: string
  /** Server timestamp (ms since epoch). */
  at: number
}

export interface WorkspaceFilesErrorResponse {
  error: string
  code:
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'invalid_path'
    | 'invalid_request'
    | 'write_disabled'
    | 'outside_workspace'
    | 'conflict'
    | 'payload_too_large'
    | 'method_not_allowed'
    | 'internal'
  actionRequired?: string
}