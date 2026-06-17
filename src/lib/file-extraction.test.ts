import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractFilePayload } from './file-extraction'
import { normalizeMediaMimeType } from './file-shared'

const execFileAsync = promisify(execFile)

async function commandExists(command: string) {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`])
    return true
  } catch {
    return false
  }
}

describe('file extraction', () => {
  it('normalizes common business document MIME types from extensions', () => {
    expect(normalizeMediaMimeType('tax-return.pdf', 'application/octet-stream')).toBe('application/pdf')
    expect(normalizeMediaMimeType('proposal.docx', 'application/octet-stream')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(normalizeMediaMimeType('ledger.xlsx', 'application/octet-stream')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(normalizeMediaMimeType('data.csv', 'application/octet-stream')).toBe('text/csv')
  })

  it('extracts text from uploaded PDFs through the server extractor', async () => {
    if (!(await commandExists('pdftotext'))) {
      return
    }

    const pdf = await PDFDocument.create()
    const page = pdf.addPage([400, 200])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText('PeakUI PDF upload extraction works', {
      x: 40,
      y: 120,
      size: 16,
      font,
    })

    const bytes = await pdf.save()
    const payload = await extractFilePayload({
      name: 'upload-test.pdf',
      type: 'application/pdf',
      size: bytes.byteLength,
      buffer: Buffer.from(bytes),
    })

    expect(payload.kind).toBe('document')
    expect(payload.type).toBe('application/pdf')
    expect(['extracted-text', 'extracted-text+vision']).toContain(payload.modelInput)
    expect(payload.text).toContain('PeakUI PDF upload extraction works')

    // When poppler can rasterize pages, the PDF is also attached as vision
    // page images so capable models can read the original layout.
    if (await commandExists('pdftoppm')) {
      expect(payload.modelInput).toBe('extracted-text+vision')
      expect(payload.pageImages?.length ?? 0).toBeGreaterThan(0)
      expect(payload.pageImages?.[0]?.type).toBe('image/jpeg')
    }
  })
})
