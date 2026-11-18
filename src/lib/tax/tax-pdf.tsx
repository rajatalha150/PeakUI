import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, StandardFonts } from 'pdf-lib'
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
  const normalized = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  // Generic names such as "name", "SSN", and "wages" appear many times in a
  // complete return (spouse, dependent, payer, multiple schedules). Only map
  // unambiguous names automatically; every other field needs an exact overlay.
  if (normalized === 'tax year' || normalized === 'taxyear') return draft.taxYear
  if (normalized === 'taxpayer name' || normalized === 'taxpayer full name') return draft.taxpayer.name?.value || null
  if (normalized === 'taxpayer ssn' || normalized === 'taxpayer social security number') return draft.taxpayer.ssn?.value || null
  if (normalized === 'taxpayer address') return draft.taxpayer.address?.value || null
  if (normalized === 'total wages') return draft.totals.wages ? String(draft.totals.wages) : null
  if (normalized === 'total federal withholding') return draft.totals.federalWithholding ? String(draft.totals.federalWithholding) : null
  return null
}

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'x', 'on', 'checked', 'check'])

/**
 * Fill an AcroForm PDF template. Values are resolved per field as:
 *   explicit `fields[fieldName]`  →  else the auto-extracted `draft` value.
 * The `fields` overlay lets the agent supply values the auto-draft does not
 * cover (e.g. Schedule C/D line items), so any IRS form can be filled from
 * client data rather than only the W-2/1099 subset. Unmatched explicit field
 * names are returned as warnings so the agent can correct them.
 */
export async function fillTaxPdfForm(
  templatePdf: Buffer,
  draft: TaxReturnDraft,
  flatten = false,
  fields: Record<string, string> = {},
): Promise<{ bytes: Buffer; filledFields: string[]; warnings: string[] }> {
  const pdfDoc = await PDFDocument.load(templatePdf)
  const form = pdfDoc.getForm()
  const warnings: string[] = []
  const formFields = form.getFields()
  if (formFields.length === 0) throw new Error('This PDF has no fillable AcroForm fields. Use a fillable template.')

  if (form.hasXFA()) {
    warnings.push('Template contains XFA data. pdf-lib cannot reliably fill XFA-only forms.')
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const filledFields: string[] = []
  const explicitNames = new Set(Object.keys(fields))

  for (const field of formFields) {
    const name = field.getName()
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(fields, name)
    const explicit = fields[name]
    const value = hasExplicitValue
      ? String(explicit)
      : draftValueForField(name, draft)
    explicitNames.delete(name)
    if (value === undefined || value === null || (value === '' && !hasExplicitValue)) continue

    try {
      if (field instanceof PDFTextField) field.setText(value)
      else if (field instanceof PDFCheckBox) {
        if (TRUTHY.has(value.toLowerCase())) field.check()
        else if (hasExplicitValue && (value === '' || /^(?:false|no|0|off|unchecked)$/i.test(value))) field.uncheck()
        else { warnings.push(`Checkbox ${name} requires an affirmative value or explicit false to clear it`); continue }
      } else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (value === '' && hasExplicitValue) field.clear()
        else if (!field.getOptions().includes(value)) {
          warnings.push(`Choice field ${name} requires one of: ${field.getOptions().join(', ')}`)
          continue
        } else field.select(value)
      } else {
        warnings.push(`Unsupported form field type: ${name}`)
        continue
      }
      filledFields.push(name)
    } catch (error) {
      warnings.push(`Could not fill ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Explicit field names that did not match any AcroForm field — likely a
  // typo or a wrong field name guessed by the agent. Surface them so the agent
  // can call inspect_form and correct the mapping.
  for (const unmatched of explicitNames) {
    if (String(fields[unmatched]).trim() !== '') {
      warnings.push(`Supplied field did not match any form field: ${unmatched}`)
    }
  }

  form.updateFieldAppearances(font)
  if (flatten) form.flatten()

  const bytes = await pdfDoc.save({ updateFieldAppearances: false })
  return { bytes: Buffer.from(bytes), filledFields, warnings }
}
