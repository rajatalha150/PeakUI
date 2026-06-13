import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { formatMoney, type TaxIncomeForm, type TaxReturnDraft } from './tax-schema'

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#111827',
  },
  title: {
    fontSize: 18,
    marginBottom: 6,
    fontWeight: 700,
  },
  subtitle: {
    fontSize: 10,
    marginBottom: 18,
    color: '#4b5563',
  },
  section: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  label: {
    width: 120,
    color: '#4b5563',
  },
  value: {
    flexGrow: 1,
  },
  warning: {
    marginBottom: 4,
    color: '#92400e',
  },
  source: {
    marginBottom: 4,
    color: '#4b5563',
    fontSize: 8,
  },
})

function fieldValue(value?: { value: string } | null) {
  return value?.value || 'Not found'
}

function MoneyRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{formatMoney(value)}</Text>
    </View>
  )
}

function IncomeFormBlock({ form, index }: { form: TaxIncomeForm; index: number }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>{index + 1}. {form.formType}</Text>
      <View style={styles.row}><Text style={styles.label}>Payer TIN</Text><Text style={styles.value}>{fieldValue(form.payerTin)}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Recipient</Text><Text style={styles.value}>{fieldValue(form.recipientName)}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Recipient TIN</Text><Text style={styles.value}>{fieldValue(form.recipientTin)}</Text></View>
      {form.wages && <View style={styles.row}><Text style={styles.label}>Wages</Text><Text style={styles.value}>{fieldValue(form.wages)}</Text></View>}
      {form.federalWithholding && <View style={styles.row}><Text style={styles.label}>Federal withheld</Text><Text style={styles.value}>{fieldValue(form.federalWithholding)}</Text></View>}
      {form.nonemployeeCompensation && <View style={styles.row}><Text style={styles.label}>NEC</Text><Text style={styles.value}>{fieldValue(form.nonemployeeCompensation)}</Text></View>}
      {form.interestIncome && <View style={styles.row}><Text style={styles.label}>Interest</Text><Text style={styles.value}>{fieldValue(form.interestIncome)}</Text></View>}
      {form.dividendIncome && <View style={styles.row}><Text style={styles.label}>Dividends</Text><Text style={styles.value}>{fieldValue(form.dividendIncome)}</Text></View>}
      {form.socialSecurityBenefits && <View style={styles.row}><Text style={styles.label}>SSA benefits</Text><Text style={styles.value}>{fieldValue(form.socialSecurityBenefits)}</Text></View>}
    </View>
  )
}

function TaxReviewDocument({ draft }: { draft: TaxReturnDraft }) {
  return (
    <Document title={`Tax review packet ${draft.taxYear}`}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Tax Return Review Packet</Text>
        <Text style={styles.subtitle}>Tax year {draft.taxYear}{draft.folder ? ` · Folder: ${draft.folder}` : ''}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Taxpayer</Text>
          <View style={styles.row}><Text style={styles.label}>Name</Text><Text style={styles.value}>{fieldValue(draft.taxpayer.name)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>SSN</Text><Text style={styles.value}>{fieldValue(draft.taxpayer.ssn)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Address</Text><Text style={styles.value}>{fieldValue(draft.taxpayer.address)}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Income Totals</Text>
          <MoneyRow label="Wages" value={draft.totals.wages} />
          <MoneyRow label="Federal withheld" value={draft.totals.federalWithholding} />
          <MoneyRow label="Nonemployee comp." value={draft.totals.nonemployeeCompensation} />
          <MoneyRow label="Interest" value={draft.totals.interestIncome} />
          <MoneyRow label="Dividends" value={draft.totals.dividendIncome} />
          <MoneyRow label="SSA benefits" value={draft.totals.socialSecurityBenefits} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Warnings And Missing Data</Text>
          {draft.warnings.map((warning, index) => <Text key={index} style={styles.warning}>- {warning}</Text>)}
        </View>

        {draft.incomeForms.map((form, index) => <IncomeFormBlock key={`${form.formType}-${index}`} form={form} index={index} />)}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Source Documents</Text>
          {draft.incomeForms.flatMap(form => form.sourceDocumentIds).map((id, index) => (
            <Text key={`${id}-${index}`} style={styles.source}>- {id}</Text>
          ))}
        </View>
      </Page>
    </Document>
  )
}

export async function renderTaxReviewPdf(draft: TaxReturnDraft): Promise<Buffer> {
  return Buffer.from(await renderToBuffer(<TaxReviewDocument draft={draft} />))
}

function draftValueForField(fieldName: string, draft: TaxReturnDraft): string | null {
  const normalized = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  if (normalized.includes('tax year') || normalized === 'year') return draft.taxYear
  if (normalized.includes('taxpayer') && normalized.includes('name')) return draft.taxpayer.name?.value || null
  if (normalized.includes('name') && !normalized.includes('spouse')) return draft.taxpayer.name?.value || null
  if (normalized.includes('ssn') || normalized.includes('social security')) return draft.taxpayer.ssn?.value || null
  if (normalized.includes('address')) return draft.taxpayer.address?.value || null
  if (normalized.includes('wage')) return String(draft.totals.wages || '')
  if (normalized.includes('withheld') || normalized.includes('withholding')) return String(draft.totals.federalWithholding || '')
  if (normalized.includes('interest')) return String(draft.totals.interestIncome || '')
  if (normalized.includes('dividend')) return String(draft.totals.dividendIncome || '')
  if (normalized.includes('nonemployee') || normalized.includes('1099 nec')) return String(draft.totals.nonemployeeCompensation || '')
  return null
}

export async function fillTaxPdfForm(templatePdf: Buffer, draft: TaxReturnDraft, flatten = false): Promise<{ bytes: Buffer; filledFields: string[]; warnings: string[] }> {
  const pdfDoc = await PDFDocument.load(templatePdf)
  const form = pdfDoc.getForm()
  const warnings: string[] = []

  if (form.hasXFA()) {
    warnings.push('Template contains XFA data. pdf-lib cannot reliably fill XFA-only forms.')
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const filledFields: string[] = []

  for (const field of form.getFields()) {
    const name = field.getName()
    const value = draftValueForField(name, draft)
    if (!value) continue

    try {
      const textField = form.getTextField(name)
      textField.setText(value)
      filledFields.push(name)
    } catch {
      try {
        const checkbox = form.getCheckBox(name)
        if (value === 'true' || value === 'yes' || value === '1') {
          checkbox.check()
          filledFields.push(name)
        }
      } catch {
        // Unsupported field type for this MVP.
      }
    }
  }

  form.updateFieldAppearances(font)
  if (flatten) form.flatten()

  const bytes = await pdfDoc.save({ updateFieldAppearances: false })
  return { bytes: Buffer.from(bytes), filledFields, warnings }
}
