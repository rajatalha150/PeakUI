import { normalizeAssistantResponseContent } from '@/lib/response-normalizer'
import type { ResponsePresentation } from '@/lib/response-format'

export type GeneratedFile = {
  name: string
  content: string
  mimeType: string
  binary: boolean
}

export type ImageDisplayFile = {
  name: string
  mimeType: string
  width?: number
  height?: number
  url?: string
  base64Data?: string
}

export interface ParsedAssistantArtifacts {
  normalizedContent: string
  generatedFiles: GeneratedFile[]
  inlineImages: ImageDisplayFile[]
}

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const MAX_CACHE_ENTRIES = 400
const parsedArtifactCache = new Map<string, ParsedAssistantArtifacts>()

function makeCacheKey(content: string, presentation?: ResponsePresentation): string {
  return JSON.stringify([presentation?.mode ?? 'general', presentation?.subject ?? '', presentation?.dataFormat ?? '', content])
}

function sanitizeDownloadName(name: string, fallback: string) {
  const base = name.trim().split(/[\\/]/).pop()?.replace(/[^\w.\- ()[\]]+/g, '_') || fallback
  return base.includes('.') ? base : fallback
}

function inferMimeType(filename: string, binary: boolean) {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_BY_EXTENSION[extension] || (binary ? 'application/octet-stream' : 'text/plain')
}

function getFilenameFromFence(info: string, body: string, index: number): { filename: string; body: string } | null {
  const metaMatch = info.match(/\b(?:file(?:name)?|path)\s*=\s*["']([^"']+)["']/i)
    || info.match(/\b(?:file(?:name)?|path)\s*=\s*([^\s]+)/i)
  if (metaMatch?.[1]) {
    const filename = sanitizeDownloadName(metaMatch[1], `generated-file-${index}.txt`)
    return { filename, body }
  }

  const firstLine = body.split(/\r?\n/, 1)[0] || ''
  const fileLineMatch = firstLine.match(/^\s*(?:\/\/|#|--|;|<!--|\/\*)\s*(?:file|filename|path):\s*([^*>\n]+?)(?:\s*\*\/|\s*-->)?\s*$/i)
  if (fileLineMatch?.[1]) {
    const filename = sanitizeDownloadName(fileLineMatch[1], `generated-file-${index}.txt`)
    return { filename, body: body.replace(firstLine, '').replace(/^\r?\n/, '') }
  }

  const likelyFilename = info
    .split(/\s+/)
    .find(part => /^[\w./\\()[\] -]+\.[A-Za-z0-9]{1,12}$/.test(part))

  if (!likelyFilename) return null
  return {
    filename: sanitizeDownloadName(likelyFilename, `generated-file-${index}.txt`),
    body,
  }
}

export function extractGeneratedFiles(content: string): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const fenceRegex = /```([^\n\r`]*)\r?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let index = 1

  while ((match = fenceRegex.exec(content)) !== null && files.length < 12) {
    const info = match[1] || ''
    const body = match[2] || ''
    const parsed = getFilenameFromFence(info, body, index)
    if (!parsed) continue

    const binary = /\bbase64\b/i.test(info)
    files.push({
      name: parsed.filename,
      content: parsed.body.trim(),
      mimeType: inferMimeType(parsed.filename, binary),
      binary,
    })
    index += 1
  }

  return files
}

export function extractInlineImages(content: string): ImageDisplayFile[] {
  const images: ImageDisplayFile[] = []
  let match: RegExpExecArray | null

  const mdExternalRegex = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g
  while ((match = mdExternalRegex.exec(content)) !== null && images.length < 20) {
    const alt = match[1] || 'Generated image'
    const url = match[2]
    const filename = url.split('/').pop() || 'image'
    const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : 'jpg'
    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    images.push({
      name: alt.includes('.') ? alt : `${alt}.${ext}`,
      mimeType,
      url,
    })
  }

  const mdImageRegex = /!\[([^\]]*)\]\(data:([^;]+);base64,([^)\s]+)\)/g
  while ((match = mdImageRegex.exec(content)) !== null && images.length < 20) {
    const alt = match[1] || 'Generated image'
    const mimeType = match[2]
    const base64 = match[3]
    const extension = mimeType?.split('/')[1] || 'png'
    const name = alt.includes('.') ? alt : `${alt}.${extension}`
    images.push({
      name,
      mimeType,
      base64Data: base64,
    })
  }

  // Relative Canvas artifact download URLs (e.g. generated images persisted
  // server-side). The browser resolves these against its own origin, so they
  // work regardless of how the user reaches PeakUI.
  const mdRelativeCanvasRegex = /!\[([^\]]*)\]\((\/api\/canvas\/artifacts\/[A-Za-z0-9_-]+\/download)\)/g
  while ((match = mdRelativeCanvasRegex.exec(content)) !== null && images.length < 20) {
    const alt = match[1] || 'Generated image'
    const url = match[2]
    const filename = url.split('/').pop() || 'image'
    const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : 'png'
    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    images.push({
      name: alt.includes('.') ? alt : `${alt}.${ext}`,
      mimeType,
      url,
    })
  }

  const base64ImgRegex = /(?:^|\n)\s*<img[^>]+src=["']data:([^"']+)["'][^>]*>/gi
  while ((match = base64ImgRegex.exec(content)) !== null && images.length < 20) {
    const parts = match[1].split(';base64,')
    if (parts.length !== 2) continue
    images.push({
      name: `generated-image-${images.length + 1}.${parts[0].split('/')[1] || 'png'}`,
      mimeType: parts[0],
      base64Data: parts[1],
    })
  }

  return images
}

function writeCacheEntry(key: string, value: ParsedAssistantArtifacts) {
  parsedArtifactCache.delete(key)
  parsedArtifactCache.set(key, value)
  if (parsedArtifactCache.size <= MAX_CACHE_ENTRIES) return
  const firstKey = parsedArtifactCache.keys().next().value
  if (typeof firstKey === 'string') parsedArtifactCache.delete(firstKey)
}

export function getParsedAssistantArtifacts(content: string, presentation?: ResponsePresentation, showImages = true): ParsedAssistantArtifacts {
  const cacheKey = makeCacheKey(content, presentation)
  const cached = parsedArtifactCache.get(cacheKey)
  if (cached) {
    parsedArtifactCache.delete(cacheKey)
    parsedArtifactCache.set(cacheKey, cached)
    return cached
  }

  const normalizedContent = normalizeAssistantResponseContent(content, presentation)
  const parsed = {
    normalizedContent,
    generatedFiles: extractGeneratedFiles(normalizedContent),
    inlineImages: showImages ? extractInlineImages(normalizedContent) : [],
  }
  writeCacheEntry(cacheKey, parsed)
  return parsed
}
