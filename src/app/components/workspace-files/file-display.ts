// File-type classification shared by the tree, preview, and editor.
// Keeps the heuristics in one place so the tree icon, preview type, and
// "is this editable?" check all agree.

import type { WorkspaceFileContent, WorkspaceFileEntry } from '@/lib/workspace-files-types'

export type FileKind =
  | 'markdown'
  | 'code'
  | 'text'
  | 'json'
  | 'csv'
  | 'image'
  | 'pdf'
  | 'binary'

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'm', 'mm',
  'php', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'yaml', 'yml', 'toml', 'ini', 'env',
  'vue', 'svelte', 'scss', 'sass', 'less', 'css',
  'xml', 'html', 'htm', 'lua', 'r', 'dart', 'ex', 'exs',
])

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'conf', 'cfg'])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'])

const IMAGE_MIME_PREFIX = 'image/'

export function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const fileName = slash >= 0 ? path.slice(slash + 1) : path
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function fileBaseName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

export function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : ''
}

export function joinPath(parent: string, child: string): string {
  if (!parent) return child
  return `${parent}/${child}`
}

/**
 * Classify a file for display purposes. The server returns encoding
 * (utf-8 vs base64) + mimeType when known; we layer extension-based guesses
 * on top for files the server doesn't recognize.
 */
export function classifyFile(input: { path: string; content?: WorkspaceFileContent; entry?: WorkspaceFileEntry }): FileKind {
  const ext = extensionOf(input.path)
  if (input.content) {
    if (input.content.encoding === 'base64') {
      if (input.content.mimeType?.startsWith(IMAGE_MIME_PREFIX)) return 'image'
      if (input.content.mimeType === 'application/pdf') return 'pdf'
      return 'binary'
    }
    if (input.content.mimeType?.startsWith(IMAGE_MIME_PREFIX)) return 'image'
    if (input.content.mimeType === 'application/pdf') return 'pdf'
  }
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'csv') return 'csv'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'text'
}

export function isEditableFile(kind: FileKind): boolean {
  return kind === 'markdown' || kind === 'code' || kind === 'text' || kind === 'json' || kind === 'csv'
}

export function humanFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}