import React from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { NormalizedPdfDocument, PdfDocumentField, PdfDocumentTable } from './document-schema'

/**
 * Per-template accent palettes. Each template gets its own primary color and
 * soft tint so structured documents render as distinct, polished reports
 * rather than one flat look.
 */
const TEMPLATE_ACCENTS: Record<NormalizedPdfDocument['template'], { primary: string; soft: string; border: string }> = {
  report: { primary: '#4f46e5', soft: '#eef2ff', border: '#c7d2fe' },
  memo: { primary: '#b45309', soft: '#fffbeb', border: '#fcd34d' },
  letter: { primary: '#0284c7', soft: '#f0f9ff', border: '#7dd3fc' },
  invoice: { primary: '#047857', soft: '#ecfdf5', border: '#6ee7b7' },
  checklist: { primary: '#7c3aed', soft: '#f5f3ff', border: '#c4b5fd' },
  form: { primary: '#be123c', soft: '#fff1f2', border: '#fda4af' },
}

const CALLOUT_LABELS: Record<string, string> = {
  warning: 'WARNING',
  success: 'SUCCESS',
  note: 'NOTE',
}

const baseStyles = StyleSheet.create({
  page: {
    padding: 42,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#111827',
    lineHeight: 1.45,
  },
  header: {
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#e5e7eb',
  },
  eyebrow: {
    fontSize: 8,
    fontWeight: 700,
    marginBottom: 5,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 10,
    color: '#4b5563',
  },
  section: {
    marginBottom: 15,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  sectionAccentBar: {
    width: 3,
    height: 14,
    marginRight: 6,
    borderRadius: 1.5,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
  },
  paragraph: {
    marginBottom: 7,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  bullet: {
    width: 12,
  },
  bulletText: {
    flexGrow: 1,
  },
  fieldGrid: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
  },
  fieldRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  fieldLabel: {
    width: 150,
    padding: 7,
    fontWeight: 700,
    borderRightWidth: 1,
    borderRightColor: '#f3f4f6',
  },
  fieldValue: {
    flexGrow: 1,
    padding: 7,
  },
  tableTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 5,
  },
  table: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableHeader: {
    flexGrow: 1,
    flexBasis: 0,
    padding: 6,
    fontSize: 8,
    fontWeight: 700,
  },
  tableCell: {
    flexGrow: 1,
    flexBasis: 0,
    padding: 6,
    fontSize: 8,
  },
  callout: {
    marginBottom: 10,
    padding: 9,
    borderLeftWidth: 3,
    borderRadius: 4,
  },
  calloutLabel: {
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 1,
    marginBottom: 3,
  },
  calloutTitle: {
    fontWeight: 700,
    marginBottom: 3,
  },
  footer: {
    position: 'absolute',
    left: 42,
    right: 42,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#6b7280',
    fontSize: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 7,
  },
})

function templateLabel(template: NormalizedPdfDocument['template']) {
  return template === 'form' ? 'Form'
    : template === 'checklist' ? 'Checklist'
      : template === 'invoice' ? 'Invoice'
        : template === 'letter' ? 'Letter'
          : template === 'memo' ? 'Memo'
            : 'Report'
}

function splitParagraphs(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
}

function renderFieldGrid(
  fields: PdfDocumentField[],
  keyPrefix: string,
  accent: { primary: string; soft: string; border: string },
) {
  if (fields.length === 0) return null
  return (
    <View style={[baseStyles.fieldGrid, { borderColor: accent.border }]}>
      {fields.map((field, index) => (
        <View key={`${keyPrefix}-field-${index}`} style={baseStyles.fieldRow}>
          <Text style={[baseStyles.fieldLabel, { color: accent.primary, backgroundColor: accent.soft }]}>
            {field.label}
          </Text>
          <Text style={baseStyles.fieldValue}>{field.value}</Text>
        </View>
      ))}
    </View>
  )
}

function tableCellValue(row: Record<string, string> | string[], column: string, index: number): string {
  if (Array.isArray(row)) return row[index] ?? ''
  return row[column] ?? ''
}

function renderTable(
  table: PdfDocumentTable,
  index: number,
  accent: { primary: string; soft: string; border: string },
) {
  return (
    <View key={`table-${index}`} style={baseStyles.section} wrap={false}>
      {table.title ? <Text style={[baseStyles.tableTitle, { color: accent.primary }]}>{table.title}</Text> : null}
      <View style={[baseStyles.table, { borderColor: accent.border }]}>
        <View style={[baseStyles.tableRow, { backgroundColor: accent.soft }]}>
          {table.columns.map(column => (
            <Text key={column} style={[baseStyles.tableHeader, { color: accent.primary }]}>{column}</Text>
          ))}
        </View>
        {table.rows.map((row, rowIndex) => (
          <View
            key={`row-${rowIndex}`}
            style={rowIndex % 2 === 1
              ? [baseStyles.tableRow, { backgroundColor: '#f9fafb' }]
              : baseStyles.tableRow}
          >
            {table.columns.map((column, columnIndex) => (
              <Text key={`${rowIndex}-${column}`} style={baseStyles.tableCell}>
                {tableCellValue(row, column, columnIndex)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

function renderCallout(
  callout: { tone?: 'note' | 'warning' | 'success'; title?: string; text: string },
  key: string,
) {
  const tone = callout.tone || 'note'
  const palette = tone === 'warning' ? { primary: '#b45309', soft: '#fffbeb', border: '#fcd34d' }
    : tone === 'success' ? { primary: '#047857', soft: '#ecfdf5', border: '#6ee7b7' }
      : { primary: '#0284c7', soft: '#f0f9ff', border: '#7dd3fc' }
  return (
    <View
      key={key}
      style={[
        baseStyles.callout,
        { borderLeftColor: palette.primary, backgroundColor: palette.soft },
      ]}
    >
      <Text style={[baseStyles.calloutLabel, { color: palette.primary }]}>
        {CALLOUT_LABELS[tone]}
      </Text>
      {callout.title ? <Text style={baseStyles.calloutTitle}>{callout.title}</Text> : null}
      <Text>{callout.text}</Text>
    </View>
  )
}

function GeneratedPdfDocument({ document }: { document: NormalizedPdfDocument }) {
  const accent = TEMPLATE_ACCENTS[document.template] || TEMPLATE_ACCENTS.report
  const footer = document.metadata.footer || 'Generated by PeakUI'
  return (
    <Document
      title={document.title}
      author={document.metadata.author || 'PeakUI'}
      subject={document.metadata.subject || document.subtitle || document.title}
    >
      <Page size="LETTER" style={baseStyles.page}>
        <View style={[baseStyles.header, { borderBottomColor: accent.border }]}>
          <Text style={[baseStyles.eyebrow, { color: accent.primary }]}>
            {templateLabel(document.template).toUpperCase()}
          </Text>
          <Text style={baseStyles.title}>{document.title}</Text>
          {document.subtitle ? <Text style={baseStyles.subtitle}>{document.subtitle}</Text> : null}
        </View>

        {document.callouts.map((callout, index) => renderCallout(callout, `callout-${index}`))}

        {renderFieldGrid(document.fields, 'root', accent)}
        {document.tables.map((table, index) => renderTable(table, index, accent))}

        {document.sections.map((section, index) => (
          <View key={`section-${index}`} style={baseStyles.section}>
            {section.heading ? (
              <View style={baseStyles.sectionHeadingRow}>
                <View style={[baseStyles.sectionAccentBar, { backgroundColor: accent.primary }]} />
                <Text style={[baseStyles.sectionTitle, { color: accent.primary }]}>{section.heading}</Text>
              </View>
            ) : null}
            {section.callouts?.map((callout, calloutIndex) => (
              renderCallout(callout, `section-${index}-callout-${calloutIndex}`)
            ))}
            {section.body ? splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
              <Text key={`paragraph-${index}-${paragraphIndex}`} style={baseStyles.paragraph}>{paragraph}</Text>
            )) : null}
            {section.bullets?.map((bullet, bulletIndex) => (
              <View key={`bullet-${index}-${bulletIndex}`} style={baseStyles.bulletRow}>
                <Text style={[baseStyles.bullet, { color: accent.primary }]}>•</Text>
                <Text style={baseStyles.bulletText}>{bullet}</Text>
              </View>
            ))}
            {section.fields ? renderFieldGrid(section.fields, `section-${index}`, accent) : null}
            {section.tables?.map((table, tableIndex) => renderTable(table, Number(`${index}${tableIndex}`), accent))}
          </View>
        ))}

        {document.content ? (
          <View style={baseStyles.section}>
            {splitParagraphs(document.content).map((paragraph, index) => {
              const heading = /^(#{1,3})\s+(.+)$/.exec(paragraph)
              if (heading) return <Text key={`content-${index}`} style={baseStyles.sectionTitle}>{heading[2]}</Text>
              const bulletLines = paragraph.split('\n').filter(line => /^[-*]\s+/.test(line.trim()))
              if (bulletLines.length > 0 && bulletLines.length === paragraph.split('\n').filter(Boolean).length) {
                return bulletLines.map((line, bulletIndex) => (
                  <View key={`content-${index}-${bulletIndex}`} style={baseStyles.bulletRow}>
                    <Text style={[baseStyles.bullet, { color: accent.primary }]}>•</Text>
                    <Text style={baseStyles.bulletText}>{line.replace(/^[-*]\s+/, '')}</Text>
                  </View>
                ))
              }
              return <Text key={`content-${index}`} style={baseStyles.paragraph}>{paragraph.replace(/^#{1,3}\s+/, '')}</Text>
            })}
          </View>
        ) : null}

        <View style={baseStyles.footer} fixed>
          <Text>{footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function renderRichDocumentPdf(document: NormalizedPdfDocument): Promise<Buffer> {
  return Buffer.from(await renderToBuffer(<GeneratedPdfDocument document={document} />))
}
