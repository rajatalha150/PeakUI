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

  it('applies an explicit fields overlay on top of the auto-draft', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([612, 792])
    const form = pdf.getForm()
    form.createTextField('taxpayer_name').addToPage(page, { x: 40, y: 720, width: 220, height: 18 })
    // A field the auto-draft does NOT know how to fill (Schedule C line).
    form.createTextField('c6_other_income').addToPage(page, { x: 40, y: 690, width: 220, height: 18 })
    const template = Buffer.from(await pdf.save())

    const filled = await fillTaxPdfForm(template, draft, false, {
      taxpayer_name: 'Override Name',
      c6_other_income: '3200',
    })

    expect(filled.filledFields).toContain('c6_other_income')
    // Explicit value wins over the draft-derived value.
    const reopened = await PDFDocument.load(filled.bytes)
    expect(reopened.getForm().getTextField('taxpayer_name').getText()).toBe('Override Name')
    expect(reopened.getForm().getTextField('c6_other_income').getText()).toBe('3200')
  })

  it('warns about explicit fields that match no form field', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([612, 792])
    const form = pdf.getForm()
    form.createTextField('taxpayer_name').addToPage(page, { x: 40, y: 720, width: 220, height: 18 })
    const template = Buffer.from(await pdf.save())

    const filled = await fillTaxPdfForm(template, draft, false, {
      taxpayer_name: 'Jane Taxpayer',
      does_not_exist: 'value',
    })

    expect(filled.filledFields).toContain('taxpayer_name')
    expect(filled.warnings.some(w => w.includes('does_not_exist'))).toBe(true)
  })

  it('checks a checkbox from a truthy explicit field value', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([612, 792])
    const form = pdf.getForm()
    form.createCheckBox('filing_status_single').addToPage(page, { x: 40, y: 720, width: 14, height: 14 })
    const template = Buffer.from(await pdf.save())

    const filled = await fillTaxPdfForm(template, draft, false, { filing_status_single: 'yes' })

    expect(filled.filledFields).toContain('filing_status_single')
    const reopened = await PDFDocument.load(filled.bytes)
    expect(reopened.getForm().getCheckBox('filing_status_single').isChecked()).toBe(true)
  })
})
