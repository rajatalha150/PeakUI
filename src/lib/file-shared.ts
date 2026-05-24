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
  nativeImageData?: string
  nativeImageType?: string
  nativeImageName?: string
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

const NATIVE_IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif',
])

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'mid', 'midi',
])

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', '3g2', 'mts', 'm2ts', 'hevc',
])

export function isNativeImageExtension(extension: string): boolean {
  return NATIVE_IMAGE_EXTENSIONS.has(extension.toLowerCase())
}

export function isAudioExtension(extension: string): boolean {
  return AUDIO_EXTENSIONS.has(extension.toLowerCase())
}

export function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTENSIONS.has(extension.toLowerCase())
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/')
}

export function isImageFile(filename: string, mimeType: string): boolean {
  return isImageMimeType(mimeType) || isNativeImageExtension(getFileExtension(filename))
}

export function isAudioFile(filename: string, mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('audio/') || isAudioExtension(getFileExtension(filename))
}

export function isVideoFile(filename: string, mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('video/') || isVideoExtension(getFileExtension(filename))
}

export function normalizeImageMimeType(filename: string, mimeType: string): string {
  const type = mimeType.toLowerCase()
  if (isImageMimeType(type)) return type

  switch (getFileExtension(filename)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    case 'avif':
      return 'image/avif'
    case 'heic':
      return 'image/heic'
    case 'heif':
      return 'image/heif'
    default:
      return mimeType
  }
}

export function normalizeMediaMimeType(filename: string, mimeType: string): string {
  const type = mimeType.toLowerCase()
  if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')) return type

  switch (getFileExtension(filename)) {
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'm4a': return 'audio/mp4'
    case 'aac': return 'audio/aac'
    case 'flac': return 'audio/flac'
    case 'ogg':
    case 'oga': return 'audio/ogg'
    case 'opus': return 'audio/opus'
    case 'wma': return 'audio/x-ms-wma'
    case 'aif':
    case 'aiff': return 'audio/aiff'
    case 'amr': return 'audio/amr'
    case 'mid':
    case 'midi': return 'audio/midi'
    case 'mp4':
    case 'm4v': return 'video/mp4'
    case 'mov': return 'video/quicktime'
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/x-matroska'
    case 'avi': return 'video/x-msvideo'
    case 'wmv': return 'video/x-ms-wmv'
    case 'flv': return 'video/x-flv'
    case 'mpg':
    case 'mpeg': return 'video/mpeg'
    case '3gp': return 'video/3gpp'
    case '3g2': return 'video/3gpp2'
    case 'mts':
    case 'm2ts': return 'video/mp2t'
    case 'hevc': return 'video/hevc'
    default:
      return normalizeImageMimeType(filename, mimeType)
  }
}

export function shouldNormalizeImageForCompatibility(filename: string, mimeType: string): boolean {
  const extension = getFileExtension(filename)
  const type = normalizeImageMimeType(filename, mimeType)
  return ['heic', 'heif', 'tif', 'tiff', 'bmp', 'avif'].includes(extension)
    || ['image/heic', 'image/heif', 'image/tiff', 'image/bmp', 'image/avif'].includes(type)
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
  if (isImageFile(filename, type)) return 'image'
  if (isAudioFile(filename, type)) return 'audio'
  if (isVideoFile(filename, type)) return 'video'
  if (isCodeExtension(extension)) return 'code'
  if (isOfficeLikeExtension(extension)) return 'document'
  if (isDataExtension(extension) || type.includes('json') || type.includes('xml') || type.includes('yaml') || type.includes('csv') || type.includes('toml') || type.includes('sql')) return 'data'
  if (type.startsWith('text/')) return 'text'
  if (isArchiveExtension(extension)) return 'archive'

  return 'binary'
}
