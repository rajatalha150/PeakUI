import { describe, expect, it } from 'vitest'
import { normalizePdfDocumentInput, pdfDocumentHasRenderableContent } from './document-schema'

describe('pdfDocumentHasRenderableContent', () => {
  it('does not treat a heading-only section as document content', () => {
    const document = normalizePdfDocumentInput({
      title: 'Report',
      sections: [{ heading: 'Executive Summary' }],
    })
    expect(pdfDocumentHasRenderableContent(document)).toBe(false)
  })

  it('accepts real section bodies and structured rows', () => {
    const document = normalizePdfDocumentInput({
      title: 'Report',
      sections: [{ heading: 'Executive Summary', body: 'Revenue increased by 18 percent.' }],
      tables: [{ columns: ['Metric'], rows: [{ Metric: 'Revenue' }] }],
    })
    expect(pdfDocumentHasRenderableContent(document)).toBe(true)
  })
})
