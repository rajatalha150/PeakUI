import { parseOffice } from 'officeparser'
import ExcelJS from 'exceljs'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import {
  CHAT_ATTACHMENT_TEXT_LIMIT,
  MAX_DOCUMENT_PAGE_IMAGES,
  detectFileKind,
  getFileExtension,
  isCodeExtension,
  isImageFile,
  isOfficeLikeExtension,
  normalizeMediaMimeType,
  shouldNormalizeImageForCompatibility,
  type AttachmentPageImage,
  type ExtractedFilePayload,
  type FileExtractionStatus,
  type FileKind,
  type FileModelInput,
} from './file-shared'
import { convertImageBufferToJpeg } from './image-normalization'

const execFileAsync = promisify(execFile)

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'log',
  'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'yaml', 'yml', 'toml',
  'ini', 'cfg', 'conf', 'env', 'gitignore', 'dockerignore', 'editorconfig',
  'svg', 'tex', 'rst', 'adoc',
])

const STRUCTURED_EXTENSIONS = new Set(['json', 'jsonl', 'ndjson', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml'])
const MAX_ARCHIVE_MEMBERS = 40
const MAX_ARCHIVE_MEMBER_BYTES = 8 * 1024 * 1024
const OCR_MIN_TEXT_THRESHOLD = 80
const OCR_DPI = 144
const PDF_PAGE_TEXT_FALLBACK_THRESHOLD = 80

interface ExtractFileOptions {
  name: string
  type?: string
  size?: number
  buffer: Buffer
  maxTextChars?: number
}

interface ExtractionContext {
  depth: number
}

function truncateText(text: string, maxTextChars = CHAT_ATTACHMENT_TEXT_LIMIT) {
  if (text.length <= maxTextChars) {
    return { text, truncated: false }
  }

  return {
    text: `${text.slice(0, maxTextChars)}\n\n[File text truncated at ${maxTextChars.toLocaleString()} characters.]`,
    truncated: true,
  }
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function isTextMimeType(mimeType: string): boolean {
  const type = mimeType.toLowerCase()
  return type.startsWith('text/') || [
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/xhtml+xml',
    'application/x-yaml',
    'application/yaml',
    'application/toml',
    'application/sql',
    'application/javascript',
    'application/typescript',
    'application/x-sh',
    'application/x-httpd-php',
  ].includes(type)
}

function isLikelyUtf8Text(buffer: Buffer): boolean {
  if (buffer.length === 0) return true

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  let suspicious = 0

  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }

  return suspicious / sample.length < 0.02
}

function guessMimeType(filename: string): string {
  const extension = getFileExtension(filename)

  switch (extension) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'tif':
    case 'tiff': return 'image/tiff'
    case 'avif': return 'image/avif'
    case 'heic': return 'image/heic'
    case 'heif': return 'image/heif'
    case 'svg': return 'image/svg+xml'
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
    case 'pdf': return 'application/pdf'
    case 'doc': return 'application/msword'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls': return 'application/vnd.ms-excel'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'xlsm': return 'application/vnd.ms-excel.sheet.macroEnabled.12'
    case 'ppt': return 'application/vnd.ms-powerpoint'
    case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'odt': return 'application/vnd.oasis.opendocument.text'
    case 'odp': return 'application/vnd.oasis.opendocument.presentation'
    case 'ods': return 'application/vnd.oasis.opendocument.spreadsheet'
    case 'rtf': return 'application/rtf'
    case 'txt': return 'text/plain'
    case 'md':
    case 'markdown': return 'text/markdown'
    case 'csv': return 'text/csv'
    case 'tsv': return 'text/tab-separated-values'
    case 'json':
    case 'jsonl':
    case 'ndjson': return 'application/json'
    case 'xml': return 'application/xml'
    case 'yaml':
    case 'yml': return 'application/yaml'
    case 'toml': return 'application/toml'
    case 'zip': return 'application/zip'
    case 'tar': return 'application/x-tar'
    case 'gz':
    case 'tgz': return 'application/gzip'
    case 'bz2': return 'application/x-bzip2'
    case 'xz': return 'application/x-xz'
    case '7z': return 'application/x-7z-compressed'
    case 'rar': return 'application/vnd.rar'
    default:
      return 'application/octet-stream'
  }
}

async function runCommand(command: string, args: string[], options: { cwd?: string; maxBuffer?: number } = {}) {
  return await execFileAsync(command, args, {
    cwd: options.cwd,
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
  }) as { stdout: string; stderr: string }
}

function formatWithLineNumbers(text: string): string {
  return text
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(4, '0')} | ${line}`)
    .join('\n')
}

function formatStructuredText(extension: string, text: string): string {
  const normalized = normalizeExtractedText(text)

  if (!normalized) return ''

  if (extension === 'json') {
    try {
      return formatWithLineNumbers(JSON.stringify(JSON.parse(normalized), null, 2))
    } catch {
      return formatWithLineNumbers(normalized)
    }
  }

  if (extension === 'jsonl' || extension === 'ndjson') {
    const lines = normalized.split('\n').filter(Boolean)
    const formatted = lines.map((line, index) => {
      try {
        return `${String(index + 1).padStart(4, '0')} | ${JSON.stringify(JSON.parse(line), null, 2)}`
      } catch {
        return `${String(index + 1).padStart(4, '0')} | ${line}`
      }
    })
    return formatted.join('\n')
  }

  if (extension === 'csv' || extension === 'tsv' || isCodeExtension(extension)) {
    return formatWithLineNumbers(normalized)
  }

  if (STRUCTURED_EXTENSIONS.has(extension)) {
    return normalized
  }

  return normalized
}

function formatTextForPayload(name: string, text: string): string {
  const extension = getFileExtension(name)
  if (!text.trim()) return ''

  if (STRUCTURED_EXTENSIONS.has(extension) || isCodeExtension(extension)) {
    return formatStructuredText(extension, text)
  }

  return normalizeExtractedText(text)
}

function makePayload(
  options: ExtractFileOptions,
  values: {
    text?: string
    ocrText?: string
    nativeImageData?: string
    nativeImageType?: string
    nativeImageName?: string
    pageImages?: AttachmentPageImage[]
    pageImagesTruncated?: boolean
    kind?: FileKind
    extractionStatus: FileExtractionStatus
    modelInput: FileModelInput
    statusMessage: string
  }
): ExtractedFilePayload {
  const extension = getFileExtension(options.name)
  const normalizedText = formatTextForPayload(options.name, values.text ?? '')
  const { text, truncated } = truncateText(normalizedText, options.maxTextChars)
  const mimeType = normalizeMediaMimeType(options.name, options.type || guessMimeType(options.name))

  return {
    name: options.name,
    type: mimeType,
    size: options.size ?? options.buffer.length,
    extension,
    kind: values.kind ?? detectFileKind(options.name, mimeType),
    text,
    ...(values.ocrText
      ? {
          ocrText: values.ocrText,
          ocrTextCharCount: values.ocrText.length,
        }
      : {}),
    ...(values.nativeImageData
      ? {
          nativeImageData: values.nativeImageData,
          nativeImageType: values.nativeImageType,
          nativeImageName: values.nativeImageName,
        }
      : {}),
    ...(values.pageImages && values.pageImages.length > 0
      ? {
          pageImages: values.pageImages,
          pageImageCount: values.pageImages.length,
          ...(values.pageImagesTruncated ? { pageImagesTruncated: true } : {}),
        }
      : {}),
    textCharCount: text.length,
    truncated,
    extractionStatus: values.extractionStatus,
    modelInput: values.modelInput,
    statusMessage: values.statusMessage,
  }
}

async function extractOfficeText(buffer: Buffer): Promise<string> {
  const ast = await parseOffice(buffer, {
    newlineDelimiter: '\n',
    outputErrorToConsole: false,
    ignoreNotes: false,
    putNotesAtLast: false,
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
  })

  return typeof ast?.toText === 'function' ? ast.toText() : ''
}

async function extractWorkbookText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const parts: string[] = []

  workbook.worksheets.slice(0, 20).forEach(worksheet => {
    const lines: string[] = []
    lines.push(`Sheet: ${worksheet.name}`)
    const maxRows = Math.min(worksheet.actualRowCount || worksheet.rowCount, 200)
    const maxCols = Math.min(worksheet.actualColumnCount || worksheet.columnCount, 30)

    for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      const values: string[] = []
      for (let colNumber = 1; colNumber <= maxCols; colNumber += 1) {
        const cell = row.getCell(colNumber)
        if (cell.value === null || cell.value === undefined) {
          values.push('')
          continue
        }
        if (typeof cell.value === 'object' && 'formula' in cell.value) {
          const formulaValue = cell.value as { formula?: string; result?: unknown }
          values.push(formulaValue.result !== undefined ? `${formulaValue.result} (= ${formulaValue.formula})` : `= ${formulaValue.formula}`)
          continue
        }
        if (typeof cell.value === 'object' && 'text' in cell.value) {
          values.push(String((cell.value as { text?: unknown }).text ?? ''))
          continue
        }
        values.push(String(cell.value))
      }
      if (values.some(value => value.trim())) {
        lines.push(values.join('\t').replace(/\t+$/g, ''))
      }
    }

    parts.push(lines.join('\n'))
  })

  return normalizeExtractedText(parts.join('\n\n'))
}

function decodeRtfHexEscapes(value: string): string {
  return value.replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  )
}

function stripRtf(value: string): string {
  return decodeRtfHexEscapes(value)
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info)[\s\S]*?\}/gi, ' ')
    .replace(/\\par[d]?/gi, '\n')
    .replace(/\\tab/gi, '\t')
    .replace(/\\line/gi, '\n')
    .replace(/\\[a-z]+\d* ?/gi, '')
    .replace(/\\[^a-z0-9]/gi, '')
    .replace(/\b(?:rtf\d+|ansi|deff\d+|fonttbl|f\d+|fs\d+|par)\b/gi, ' ')
    .replace(/[{}]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`], { maxBuffer: 1024 })
    return true
  } catch {
    return false
  }
}

async function ocrImageFile(imagePath: string): Promise<string> {
  if (!(await commandExists('tesseract'))) return ''
  try {
    const { stdout } = await runCommand('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6', '--oem', '1'], {
      maxBuffer: 10 * 1024 * 1024,
    })
    return normalizeExtractedText(stdout)
  } catch {
    return ''
  }
}

async function extractImageText(buffer: Buffer, extension: string): Promise<string> {
  if (!(await commandExists('tesseract'))) return ''

  const tempDir = await mkdtemp(path.join(tmpdir(), 'peakui-ocr-'))
  try {
    const filePath = path.join(tempDir, `image.${extension || 'png'}`)
    await writeFile(filePath, buffer)
    return await ocrImageFile(filePath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function shouldNormalizeImageForVision(extension: string, mimeType: string): boolean {
  return shouldNormalizeImageForCompatibility(`image.${extension || 'bin'}`, mimeType)
}

function replaceImageExtension(filename: string, extension: string) {
  return filename.includes('.')
    ? filename.replace(/\.[^.]+$/, `.${extension}`)
    : `${filename}.${extension}`
}

async function normalizeNativeImageForVision(
  buffer: Buffer,
  filename: string,
  extension: string,
  mimeType: string,
): Promise<{ data?: string; type?: string; name?: string; message?: string }> {
  if (!shouldNormalizeImageForVision(extension, mimeType)) return {}

  try {
    const converted = await convertImageBufferToJpeg(buffer, { name: filename, mimeType })
    return {
      data: converted.data.toString('base64'),
      type: 'image/jpeg',
      name: replaceImageExtension(filename, 'jpg'),
      message: `Converted the uploaded image to JPEG for browser preview and vision-model compatibility (${converted.method}).`,
    }
  } catch (error) {
    console.error('Image normalization failed:', error)
    return {
      message: 'Image bytes stay attached for vision models, but conversion to JPEG failed in this runtime.',
    }
  }
}

async function ocrPdfPage(pdfPath: string, tempDir: string, pageNumber: number): Promise<string> {
  if (!(await commandExists('pdftoppm')) || !(await commandExists('tesseract'))) return ''

  const prefix = path.join(tempDir, `page-${pageNumber}`)
  try {
    await runCommand('pdftoppm', ['-png', '-singlefile', '-r', String(OCR_DPI), '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, prefix], {
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch {
    return ''
  }

  return await ocrImageFile(`${prefix}.png`)
}

async function ocrPdfDocument(pdfPath: string, tempDir: string): Promise<string> {
  if (!(await commandExists('pdftoppm')) || !(await commandExists('tesseract'))) return ''

  const prefix = path.join(tempDir, 'page')
  try {
    await runCommand('pdftoppm', ['-png', '-r', String(OCR_DPI), pdfPath, prefix], {
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch {
    return ''
  }

  const pageFiles = (await readdir(tempDir))
    .filter(entry => entry.startsWith('page-') && entry.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const pageTexts: string[] = []
  for (let index = 0; index < pageFiles.length; index += 1) {
    const pagePath = path.join(tempDir, pageFiles[index])
    const pageText = await ocrImageFile(pagePath)
    if (pageText.trim()) {
      pageTexts.push(`Page ${index + 1}\n${pageText.trim()}`)
    }
  }

  return normalizeExtractedText(pageTexts.join('\n\n'))
}

async function countPdfPages(pdfPath: string): Promise<number | null> {
  if (!(await commandExists('pdfinfo'))) return null
  try {
    const { stdout } = await runCommand('pdfinfo', [pdfPath], { maxBuffer: 1024 * 1024 })
    const match = stdout.match(/^Pages:\s+(\d+)/m)
    return match ? Number.parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

// Render the first N pages of a PDF to JPEG images so vision-capable models can
// see the full document (layout, tables, stamps, signatures) instead of only
// the flattened text layer. Best-effort: returns [] when poppler is missing.
async function renderPdfPageImages(
  pdfPath: string,
  tempDir: string,
  cap = MAX_DOCUMENT_PAGE_IMAGES,
): Promise<{ images: AttachmentPageImage[]; totalPages: number | null }> {
  if (!(await commandExists('pdftoppm'))) return { images: [], totalPages: null }

  const totalPages = await countPdfPages(pdfPath)
  const lastPage = totalPages ? Math.min(totalPages, cap) : cap
  const prefix = path.join(tempDir, 'vision-page')

  try {
    await runCommand(
      'pdftoppm',
      ['-jpeg', '-r', '150', '-f', '1', '-l', String(lastPage), pdfPath, prefix],
      { maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    return { images: [], totalPages }
  }

  const pageFiles = (await readdir(tempDir))
    .filter(entry => entry.startsWith('vision-page') && /\.jpe?g$/i.test(entry))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, cap)

  const images: AttachmentPageImage[] = []
  for (let index = 0; index < pageFiles.length; index += 1) {
    try {
      const data = await readFile(path.join(tempDir, pageFiles[index]))
      images.push({
        data: data.toString('base64'),
        type: 'image/jpeg',
        name: `page-${index + 1}.jpg`,
        page: index + 1,
      })
    } catch {
      // Skip unreadable page renders without failing the whole extraction.
    }
  }

  return { images, totalPages }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'peakui-pdf-'))
  const pdfPath = path.join(tempDir, 'source.pdf')
  let bestText = ''

  try {
    await writeFile(pdfPath, buffer)

    try {
      const { stdout } = await runCommand('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
        maxBuffer: 20 * 1024 * 1024,
      })
      const text = normalizeExtractedText(stdout)
      if (text.length > bestText.length) {
        bestText = text
      }
      if (text.length >= OCR_MIN_TEXT_THRESHOLD) {
        return text
      }
    }
    catch {
      // Fall through to OCR when available.
    }

    const ocrText = await ocrPdfDocument(pdfPath, tempDir)
    if (ocrText.trim()) {
      return ocrText
    }

    return bestText
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function renderPdfVisionPages(
  buffer: Buffer,
  cap = MAX_DOCUMENT_PAGE_IMAGES,
): Promise<{ images: AttachmentPageImage[]; totalPages: number | null }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'peakui-pdf-vision-'))
  const pdfPath = path.join(tempDir, 'source.pdf')
  try {
    await writeFile(pdfPath, buffer)
    return await renderPdfPageImages(pdfPath, tempDir, cap)
  } catch {
    return { images: [], totalPages: null }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const entries: string[] = []

  async function walk(currentDir: string, relativeDir = ''): Promise<void> {
    const dirEntries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of dirEntries) {
      const relativePath = path.join(relativeDir, entry.name)
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath)
      } else if (entry.isFile()) {
        entries.push(relativePath)
      }
    }
  }

  await walk(rootDir)
  return entries
}

async function extractArchiveText(options: ExtractFileOptions, context: ExtractionContext): Promise<string> {
  if (!(await commandExists('7z')) || context.depth >= 2) {
    return ''
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'peakui-archive-'))
  const archivePath = path.join(tempDir, options.name.replace(/[\\/]/g, '_') || 'archive.bin')

  try {
    await writeFile(archivePath, options.buffer)
    const unpackDir = path.join(tempDir, 'contents')
    await mkdir(unpackDir, { recursive: true })
    await runCommand('7z', ['x', '-y', `-o${unpackDir}`, archivePath], { maxBuffer: 20 * 1024 * 1024 })

    const files = await walkFiles(unpackDir)
    if (files.length === 0) return ''

    const sections: string[] = []
    let processedMembers = 0

    for (const relativePath of files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (processedMembers >= MAX_ARCHIVE_MEMBERS) {
        sections.push(`[Archive truncated after ${MAX_ARCHIVE_MEMBERS} members.]`)
        break
      }

      const fullPath = path.join(unpackDir, relativePath)
      const stats = await stat(fullPath)
      if (stats.size > MAX_ARCHIVE_MEMBER_BYTES) {
        sections.push(`## ${relativePath}\n[Skipped: ${stats.size.toLocaleString()} byte member too large to unpack safely.]`)
        continue
      }

      const memberBuffer = await readFile(fullPath)
      const memberPayload = await extractFilePayloadInternal({
        name: relativePath,
        type: guessMimeType(relativePath),
        size: stats.size,
        buffer: memberBuffer,
        maxTextChars: options.maxTextChars,
      }, { depth: context.depth + 1 })

      if (memberPayload.text.trim()) {
        sections.push(`## ${relativePath}\n${memberPayload.text.trim()}`)
      } else {
        sections.push(`## ${relativePath}\n[${memberPayload.statusMessage}]`)
      }

      processedMembers += 1
    }

    return normalizeExtractedText(sections.join('\n\n'))
  } catch {
    return ''
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function extractFilePayloadInternal(options: ExtractFileOptions, context: ExtractionContext): Promise<ExtractedFilePayload> {
  const extension = getFileExtension(options.name)
  const mimeType = normalizeMediaMimeType(options.name, options.type || guessMimeType(options.name))
  const kind = detectFileKind(options.name, mimeType)

  if (kind === 'archive') {
    const text = await extractArchiveText(options, context)
    return makePayload(options, {
      kind: 'archive',
      text,
      extractionStatus: text.trim() ? 'extracted' : 'unsupported',
      modelInput: text.trim() ? 'extracted-text' : 'metadata-only',
      statusMessage: text.trim()
        ? 'Extracted and flattened archive contents.'
        : 'Archive unpacking is unavailable in this environment.',
    })
  }

  if (isImageFile(options.name, mimeType) && extension !== 'svg') {
    const [ocrText, nativeImage] = await Promise.all([
      extractImageText(options.buffer, extension || 'png'),
      normalizeNativeImageForVision(options.buffer, options.name, extension, mimeType),
    ])
    return makePayload(options, {
      kind: 'image',
      extractionStatus: 'native',
      modelInput: 'native-image',
      ...(nativeImage.data
        ? {
            nativeImageData: nativeImage.data,
            nativeImageType: nativeImage.type,
            nativeImageName: nativeImage.name,
          }
        : {}),
      ...(ocrText.trim()
        ? {
            ocrText: normalizeExtractedText(ocrText),
            statusMessage: [
              nativeImage.message,
              'Image bytes stay attached for vision models. OCR text is available as optional supplemental context.',
            ].filter(Boolean).join(' '),
          }
        : {
            statusMessage: [
              nativeImage.message,
              'Image bytes are sent as native image input when the selected model supports vision.',
            ].filter(Boolean).join(' '),
          }),
    })
  }

  if (extension === 'pdf') {
    const [pdfText, vision] = await Promise.all([
      extractPdfText(options.buffer),
      renderPdfVisionPages(options.buffer),
    ])
    const pageImages = vision.images
    const hasPages = pageImages.length > 0
    const pagesTruncated = Boolean(vision.totalPages && vision.totalPages > pageImages.length)
    const visionNote = hasPages
      ? ` Rendered ${pageImages.length} page image${pageImages.length === 1 ? '' : 's'}${
          pagesTruncated ? ` (first ${pageImages.length} of ${vision.totalPages})` : ''
        } so vision-capable models can read the original layout.`
      : ''

    if (pdfText.trim()) {
      return makePayload(options, {
        kind: 'document',
        text: pdfText,
        ...(hasPages ? { pageImages, pageImagesTruncated: pagesTruncated } : {}),
        extractionStatus: 'extracted',
        modelInput: hasPages ? 'extracted-text+vision' : 'extracted-text',
        statusMessage: `Extracted text from the PDF text layer and OCR fallback when available.${visionNote}`,
      })
    }

    if (hasPages) {
      return makePayload(options, {
        kind: 'document',
        pageImages,
        pageImagesTruncated: pagesTruncated,
        extractionStatus: 'extracted',
        modelInput: 'extracted-text+vision',
        statusMessage: `No searchable text layer was found, but${visionNote.replace(' Rendered', ' rendered')} Vision-capable models can still read it as images.`,
      })
    }

    return makePayload(options, {
      kind: 'document',
      extractionStatus: 'error',
      modelInput: 'metadata-only',
      statusMessage: 'Could not extract searchable text from this PDF.',
    })
  }

  if (extension === 'xlsx' || extension === 'xlsm') {
    try {
      const text = await extractWorkbookText(options.buffer)
      return makePayload(options, {
        kind: 'document',
        text,
        extractionStatus: text.trim() ? 'extracted' : 'unsupported',
        modelInput: text.trim() ? 'extracted-text' : 'metadata-only',
        statusMessage: text.trim()
          ? 'Extracted workbook sheets, rows, and formulas for model context.'
          : 'No extractable workbook rows were found.',
      })
    } catch (error) {
      console.warn('Excel workbook extraction failed, falling back to office parser:', error)
    }
  }

  if (isOfficeLikeExtension(extension)) {
    try {
      const extractedText = await extractOfficeText(options.buffer)
      const text = extractedText.trim() || (extension === 'rtf' ? stripRtf(options.buffer.toString('utf8')) : '')
      return makePayload(options, {
        kind: 'document',
        text,
        extractionStatus: 'extracted',
        modelInput: text.trim() ? 'extracted-text' : 'metadata-only',
        statusMessage: text.trim()
          ? 'Extracted text from the original document format.'
          : 'No extractable text was found in this document.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse document.'
      if (extension === 'rtf') {
        const text = stripRtf(options.buffer.toString('utf8'))
        if (text.trim()) {
          return makePayload(options, {
            kind: 'document',
            text,
            extractionStatus: 'extracted',
            modelInput: 'extracted-text',
            statusMessage: 'Extracted text from RTF fallback parser.',
          })
        }
      }

      if (isLikelyUtf8Text(options.buffer)) {
        return makePayload(options, {
          kind: 'document',
          text: options.buffer.toString('utf8'),
          extractionStatus: 'text',
          modelInput: 'extracted-text',
          statusMessage: 'Read document as UTF-8 text after structured extraction failed.',
        })
      }

      return makePayload(options, {
        kind: 'document',
        extractionStatus: 'error',
        modelInput: 'metadata-only',
        statusMessage: `Could not extract text from this document: ${message}`,
      })
    }
  }

  if (TEXT_EXTENSIONS.has(extension) || isTextMimeType(mimeType) || isCodeExtension(extension) || isLikelyUtf8Text(options.buffer)) {
    const text = options.buffer.toString('utf8')
    return makePayload(options, {
      kind,
      text,
      extractionStatus: 'text',
      modelInput: 'extracted-text',
      statusMessage: 'Read file as UTF-8 text.',
    })
  }

  return makePayload(options, {
    kind,
    extractionStatus: 'unsupported',
    modelInput: 'metadata-only',
    statusMessage: 'This file type can be attached and tracked, but no text extractor is available for model context.',
  })
}

export async function extractFilePayload(options: ExtractFileOptions): Promise<ExtractedFilePayload> {
  return await extractFilePayloadInternal(options, { depth: 0 })
}
