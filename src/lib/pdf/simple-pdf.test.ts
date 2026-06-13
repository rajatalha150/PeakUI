import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderSimplePdf } from './simple-pdf'

describe('renderSimplePdf', () => {
  it('creates a valid PDF buffer from markdown-like content', async () => {
    const buffer = await renderSimplePdf({
      title: 'Sample PDF',
      content: '# Heading\n\n- First item\n- Second item\n\nThis is a generated document.',
    })

    const loaded = await PDFDocument.load(buffer)
    expect(buffer.byteLength).toBeGreaterThan(500)
    expect(loaded.getPageCount()).toBeGreaterThan(0)
  })
})
