import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { fillTaxPdfForm } from './tax-pdf'
import type { TaxReturnDraft } from './tax-schema'

const draft: TaxReturnDraft = {
  taxYear: '2025',
  folder: 'taxes/2025',
  taxpayer: {
    name: { value: 'Jane Taxpayer', confidence: 0.9, sources: [] },
    ssn: { value: '123-45-6789', confidence: 0.9, sources: [] },
    address: { value: '123 Main St, Albany, NY 12207', confidence: 0.8, sources: [] },
  },
  incomeForms: [],
  totals: {
    wages: 50000,
    federalWithholding: 6000,
    nonemployeeCompensation: 1200,
    interestIncome: 45,
    dividendIncome: 80,
    socialSecurityBenefits: 0,
  },
  warnings: [],
  missingFields: [],
  sourceDocumentIds: [],
}

describe('fillTaxPdfForm', () => {
  it('fills matching AcroForm text fields', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([612, 792])
    const form = pdf.getForm()
    form.createTextField('taxpayer_name').addToPage(page, { x: 40, y: 720, width: 220, height: 18 })
    form.createTextField('taxpayer_ssn').addToPage(page, { x: 40, y: 690, width: 220, height: 18 })
    const template = Buffer.from(await pdf.save())

    const filled = await fillTaxPdfForm(template, draft)

    expect(filled.filledFields).toContain('taxpayer_name')
    expect(filled.filledFields).toContain('taxpayer_ssn')
    expect(filled.bytes.byteLength).toBeGreaterThan(0)
  })
})
