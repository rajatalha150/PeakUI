export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_LABEL = '100 MB'
export const CHAT_ATTACHMENT_TEXT_LIMIT = 120000

export type FileKind = 'image' | 'document' | 'text' | 'code' | 'data' | 'archive' | 'audio' | 'video' | 'binary'
export type FileExtractionStatus = 'native' | 'extracted' | 'text' | 'unsupported' | 'error'
export type FileModelInput = 'native-image' | 'extracted-text' | 'metadata-only'

export interface ExtractedFilePayload {
  name: string
  type: string
  size: number
  extension: string
  kind: FileKind
  text: string
  ocrText?: string
  ocrTextCharCount?: number
  textCharCount: number
  truncated: boolean
  extractionStatus: FileExtractionStatus
  modelInput: FileModelInput
  statusMessage: string
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getFileExtension(filename: string): string {
  const clean = filename.split(/[?#]/)[0] ?? filename
  const lastDot = clean.lastIndexOf('.')
  if (lastDot === -1 || lastDot === clean.length - 1) return ''
  return clean.slice(lastDot + 1).toLowerCase()
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/')
}

export function isArchiveExtension(extension: string): boolean {
  return [
    'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'war', 'jar', 'apk', 'dmg', 'iso'
  ].includes(extension)
}

export function isOfficeLikeExtension(extension: string): boolean {
  return ['pdf', 'doc', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf'].includes(extension)
}

export function isDataExtension(extension: string): boolean {
  return ['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sql'].includes(extension)
}

export function isCodeExtension(extension: string): boolean {
  return [
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'php', 'java', 'c', 'h',
    'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'sh',
    'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'lua',
    'pl', 'r', 'dart', 'vue', 'svelte', 'astro', 'tsx', 'jsx', 'mdx',
  ].includes(extension)
}

export function detectFileKind(filename: string, mimeType: string): FileKind {
  const type = mimeType.toLowerCase()
  const extension = getFileExtension(filename)

  if (extension === 'svg') return 'text'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (isCodeExtension(extension)) return 'code'
  if (isOfficeLikeExtension(extension)) return 'document'
  if (isDataExtension(extension) || type.includes('json') || type.includes('xml') || type.includes('yaml') || type.includes('csv') || type.includes('toml') || type.includes('sql')) return 'data'
  if (type.startsWith('text/')) return 'text'
  if (isArchiveExtension(extension)) return 'archive'

  return 'binary'
}
