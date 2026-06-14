export type ArtifactPresentationType =
  | 'auto'
  | 'report'
  | 'code'
  | 'table'
  | 'chart'
  | 'diagram'
  | 'slides'
  | 'memo'
  | 'data'
  | 'pdf'
  | 'workbook'
  | 'file'

export type ArtifactPreviewKind =
  | 'file'
  | 'pdf'
  | 'markdown'
  | 'image'
  | 'code'
  | 'table'
  | 'chart'
  | 'diagram'
  | 'data'
  | 'slides'

export type ArtifactExportTarget = 'memo' | 'report' | 'dev-handoff'

export interface CanvasArtifactComputedMetadata {
  previewKind: ArtifactPreviewKind
  previewSummary: string | null
  previewWidth: number | null
  previewHeight: number | null
  contentHash: string
  presentationType: ArtifactPresentationType
  bundleId: string | null
  bundleName: string | null
  bundleRole: string | null
  exportTargets: ArtifactExportTarget[]
}

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'rs', 'go', 'java', 'cs', 'cpp', 'c',
  'h', 'css', 'scss', 'html', 'xml', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'toml',
])

const TABLE_EXTENSIONS = new Set(['csv', 'tsv'])
const WORKBOOK_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls'])
const DATA_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'xml'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

function hashContent(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}

function getExtension(name: string, explicitExtension?: string | null): string {
  if (explicitExtension) return explicitExtension.toLowerCase()
  const ext = name.split('.').pop()
  return ext ? ext.toLowerCase() : ''
}

function guessBundleRole(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower.includes('summary')) return 'summary'
  if (lower.includes('appendix')) return 'appendix'
  if (lower.includes('asset')) return 'asset'
  if (lower.includes('report')) return 'report'
  if (lower.includes('memo')) return 'memo'
  if (lower.includes('slide') || lower.includes('deck')) return 'slides'
  if (lower.includes('chart')) return 'chart'
  if (lower.includes('table')) return 'table'
  return null
}

function buildBundleName(name: string, role: string | null): string | null {
  const stem = name.replace(/\.[^.]+$/, '').trim()
  if (!stem) return null
  if (!role) return stem
  const rolePattern = new RegExp(`[-_ ]?${role}$`, 'i')
  return stem.replace(rolePattern, '').trim() || stem
}

function inferPresentationType(name: string, mimeType: string, kind: string, content: string, extension: string): ArtifactPresentationType {
  const lowerName = name.toLowerCase()
  const trimmed = content.trim()
  if (mimeType === 'application/pdf' || extension === 'pdf' || kind === 'pdf') return 'pdf'
  if (
    kind === 'workbook'
    || WORKBOOK_EXTENSIONS.has(extension)
    || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mimeType === 'application/vnd.ms-excel'
  ) return 'workbook'
  if (mimeType.startsWith('image/')) {
    if (lowerName.includes('diagram')) return 'diagram'
    if (lowerName.includes('chart') || lowerName.includes('graph')) return 'chart'
    return 'diagram'
  }
  if (TABLE_EXTENSIONS.has(extension) || mimeType === 'text/csv') return 'table'
  if (DATA_EXTENSIONS.has(extension) || mimeType === 'application/json') {
    if (lowerName.includes('chart') || lowerName.includes('graph')) return 'chart'
    return 'data'
  }
  if (MARKDOWN_EXTENSIONS.has(extension) || mimeType === 'text/markdown' || kind === 'markdown') {
    if (lowerName.includes('slide') || lowerName.includes('deck') || /^# .+\n(?:- .+\n?){2,}/m.test(trimmed)) return 'slides'
    if (lowerName.includes('memo')) return 'memo'
    if (lowerName.includes('report')) return 'report'
    return 'report'
  }
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  if (kind === 'data') return 'data'
  return 'file'
}

function inferPreviewKind(presentationType: ArtifactPresentationType, mimeType: string, extension: string, kind: string): ArtifactPreviewKind {
  if (presentationType === 'pdf' || mimeType === 'application/pdf' || extension === 'pdf' || kind === 'pdf') return 'pdf'
  if (presentationType === 'workbook' || WORKBOOK_EXTENSIONS.has(extension) || kind === 'workbook') return 'file'
  if (mimeType.startsWith('image/')) return 'image'
  if (presentationType === 'table') return 'table'
  if (presentationType === 'chart') return 'chart'
  if (presentationType === 'slides') return 'slides'
  if (presentationType === 'diagram') return 'diagram'
  if (presentationType === 'report' || kind === 'markdown' || MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
  if (presentationType === 'code' || CODE_EXTENSIONS.has(extension)) return 'code'
  if (presentationType === 'data' || kind === 'data') return 'data'
  return 'file'
}

function summarizeContent(content: string, previewKind: ArtifactPreviewKind): string | null {
  const trimmed = content.trim()
  if (!trimmed) return null
  if (previewKind === 'pdf') return 'Generated PDF document'
  if (previewKind === 'image') return null
  const firstHeading = trimmed.match(/^#*\s*([^\n]{8,120})/m)?.[1]?.trim()
  if (firstHeading) return firstHeading.slice(0, 120)
  const firstSentence = trimmed.replace(/\s+/g, ' ').slice(0, 180)
  return firstSentence || null
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let index = 0; index < pngSignature.length; index += 1) {
    if (bytes[index] !== pngSignature[index]) return null
  }
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
  return width > 0 && height > 0 ? { width, height } : null
}

function parseGifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null
  const header = String.fromCharCode(...bytes.slice(0, 6))
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  return width > 0 && height > 0 ? { width, height } : null
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    const blockLength = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (blockLength < 2) return null
    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
      marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf
    ) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += 2 + blockLength
  }
  return null
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null
  const riff = String.fromCharCode(...bytes.slice(0, 4))
  const webp = String.fromCharCode(...bytes.slice(8, 12))
  if (riff !== 'RIFF' || webp !== 'WEBP') return null
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    return { width, height }
  }
  return null
}

export function extractImageDimensions(base64Data: string, mimeType: string): { width: number; height: number } | null {
  try {
    const buffer = Uint8Array.from(Buffer.from(base64Data.replace(/\s+/g, ''), 'base64'))
    if (mimeType === 'image/png') return parsePngDimensions(buffer)
    if (mimeType === 'image/gif') return parseGifDimensions(buffer)
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return parseJpegDimensions(buffer)
    if (mimeType === 'image/webp') return parseWebpDimensions(buffer)
  } catch {
    return null
  }
  return null
}

function inferExportTargets(presentationType: ArtifactPresentationType, previewKind: ArtifactPreviewKind): ArtifactExportTarget[] {
  if (previewKind === 'image') return ['report']
  if (previewKind === 'pdf' || presentationType === 'pdf') return ['report']
  if (presentationType === 'workbook') return ['report', 'dev-handoff']
  if (presentationType === 'code') return ['dev-handoff', 'report']
  if (presentationType === 'report' || presentationType === 'slides' || presentationType === 'memo') return ['memo', 'report']
  if (presentationType === 'table' || presentationType === 'chart' || presentationType === 'data') return ['report', 'dev-handoff']
  return ['report']
}

export function parseArtifactExportTargets(value: string | null | undefined): ArtifactExportTarget[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is ArtifactExportTarget => entry === 'memo' || entry === 'report' || entry === 'dev-handoff'
    )
  } catch {
    return []
  }
}

export function serializeArtifactExportTargets(targets: ArtifactExportTarget[]): string {
  return JSON.stringify(Array.from(new Set(targets)))
}

export function computeCanvasArtifactMetadata(input: {
  name: string
  content: string
  mimeType?: string | null
  kind?: string | null
  extension?: string | null
  sessionId: string
  messageId?: string | null
  bundleId?: string | null
  bundleName?: string | null
  bundleRole?: string | null
}): CanvasArtifactComputedMetadata {
  const mimeType = input.mimeType || 'text/plain'
  const kind = input.kind || 'file'
  const extension = getExtension(input.name, input.extension)
  const contentHash = hashContent(input.content)
  const presentationType = inferPresentationType(input.name, mimeType, kind, input.content, extension)
  const previewKind = inferPreviewKind(presentationType, mimeType, extension, kind)
  const imageDimensions = mimeType.startsWith('image/')
    ? extractImageDimensions(input.content, mimeType)
    : null
  const bundleRole = input.bundleRole || guessBundleRole(input.name)
  const bundleName = input.bundleName || buildBundleName(input.name, bundleRole)
  const bundleId = input.bundleId || input.messageId || null

  return {
    previewKind,
    previewSummary: summarizeContent(input.content, previewKind),
    previewWidth: imageDimensions?.width ?? null,
    previewHeight: imageDimensions?.height ?? null,
    contentHash,
    presentationType,
    bundleId,
    bundleName,
    bundleRole,
    exportTargets: inferExportTargets(presentationType, previewKind),
  }
}
