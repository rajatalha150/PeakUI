import { normalizePdfDocumentInput, type PdfDocumentInput } from './document-schema'
import { renderRichDocumentPdf } from './rich-document-pdf'

export async function renderSimplePdf(input: {
  title: string
  content: string
  footer?: string
}): Promise<Buffer> {
  return renderRichDocumentPdf(normalizePdfDocumentInput({
    ...input,
    metadata: {
      footer: input.footer,
    },
  }))
}

export async function renderPdfDocument(input: PdfDocumentInput): Promise<Buffer> {
  return renderRichDocumentPdf(normalizePdfDocumentInput(input))
}
