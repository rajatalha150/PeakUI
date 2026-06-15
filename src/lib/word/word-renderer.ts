import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type {
  NormalizedWordDocument,
  WordDocumentCallout,
  WordDocumentField,
  WordDocumentTable,
} from './word-schema'

const COLORS = {
  primary: '111827',
  muted: '4B5563',
  border: 'D1D5DB',
  headerFill: '1F2937',
  headerText: 'FFFFFF',
  soft: 'EFF6FF',
  note: 'DBEAFE',
  warning: 'FEF3C7',
  success: 'DCFCE7',
}

function paragraph(text: string, options: {
  bold?: boolean
  italics?: boolean
  size?: number
  color?: string
  spacingAfter?: number
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
} = {}) {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { after: options.spacingAfter ?? 160 },
    children: [
      new TextRun({
        text,
        bold: options.bold,
        italics: options.italics,
        size: options.size ?? 22,
        color: options.color ?? COLORS.primary,
      }),
    ],
  })
}

function bodyParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map(block => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(block => paragraph(block, { spacingAfter: 180 }))
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) {
  return new Paragraph({
    heading: level,
    spacing: { before: 220, after: 140 },
    children: [new TextRun({ text, bold: true, color: COLORS.primary })],
  })
}

function bulletList(items: string[]): Paragraph[] {
  return items.map(item => new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text: item, size: 22, color: COLORS.primary })],
  }))
}

function numberedList(items: string[]): Paragraph[] {
  return items.map(item => new Paragraph({
    numbering: { reference: 'default-numbering', level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text: item, size: 22, color: COLORS.primary })],
  }))
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
    left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
    right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
  }
}

function renderFields(fields: WordDocumentField[]): Table | null {
  if (fields.length === 0) return null
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: fields.map(field => new TableRow({
      children: [
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: COLORS.soft },
          borders: tableBorders(),
          children: [paragraph(field.label, { bold: true, size: 20, spacingAfter: 0 })],
        }),
        new TableCell({
          width: { size: 68, type: WidthType.PERCENTAGE },
          borders: tableBorders(),
          children: [paragraph(field.value, { size: 20, spacingAfter: 0 })],
        }),
      ],
    })),
  })
}

function rowValue(row: WordDocumentTable['rows'][number], column: string, columnIndex: number): string {
  if (Array.isArray(row)) return String(row[columnIndex] ?? '')
  return String(row[column] ?? '')
}

function renderDataTable(table: WordDocumentTable): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = []
  if (table.title) children.push(paragraph(table.title, { bold: true, size: 23, spacingAfter: 90 }))

  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: table.columns.map(column => new TableCell({
          shading: { type: ShadingType.CLEAR, fill: COLORS.headerFill },
          borders: tableBorders(),
          children: [paragraph(column, { bold: true, color: COLORS.headerText, size: 19, spacingAfter: 0 })],
        })),
      }),
      ...table.rows.map(row => new TableRow({
        children: table.columns.map((column, columnIndex) => new TableCell({
          borders: tableBorders(),
          children: [paragraph(rowValue(row, column, columnIndex), { size: 19, spacingAfter: 0 })],
        })),
      })),
    ],
  }))

  return children
}

function calloutFill(callout: WordDocumentCallout): string {
  if (callout.tone === 'warning') return COLORS.warning
  if (callout.tone === 'success') return COLORS.success
  return COLORS.note
}

function renderCallout(callout: WordDocumentCallout): Table {
  const lines = [
    callout.title ? paragraph(callout.title, { bold: true, size: 20, spacingAfter: 80 }) : null,
    paragraph(callout.text, { size: 20, spacingAfter: 0 }),
  ].filter((entry): entry is Paragraph => Boolean(entry))

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: calloutFill(callout) },
            borders: tableBorders(),
            children: lines,
          }),
        ],
      }),
    ],
  })
}

function renderTopMatter(input: NormalizedWordDocument): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: input.subtitle ? 120 : 260 },
      children: [new TextRun({ text: input.title, bold: true, size: 40, color: COLORS.primary })],
    }),
  ]

  if (input.subtitle) {
    children.push(paragraph(input.subtitle, {
      italics: true,
      color: COLORS.muted,
      size: 24,
      alignment: AlignmentType.CENTER,
      spacingAfter: 260,
    }))
  }

  if (input.metadata.subject || input.metadata.author || input.metadata.company) {
    const fields = [
      input.metadata.subject ? { label: 'Subject', value: input.metadata.subject } : null,
      input.metadata.author ? { label: 'Prepared by', value: input.metadata.author } : null,
      input.metadata.company ? { label: 'Company', value: input.metadata.company } : null,
    ].filter((field): field is WordDocumentField => Boolean(field))
    const fieldTable = renderFields(fields)
    if (fieldTable) children.push(fieldTable)
  }

  return children
}

export async function renderWordDocument(input: NormalizedWordDocument): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [...renderTopMatter(input)]

  if (input.fields.length) {
    children.push(heading('Details', HeadingLevel.HEADING_2))
    const fieldTable = renderFields(input.fields)
    if (fieldTable) children.push(fieldTable)
  }

  if (input.content) {
    children.push(...bodyParagraphs(input.content))
  }

  for (const callout of input.callouts) {
    children.push(renderCallout(callout))
  }

  for (const table of input.tables) {
    children.push(...renderDataTable(table))
  }

  for (const section of input.sections) {
    if (section.pageBreakBefore) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    if (section.heading) children.push(heading(section.heading))
    if (section.body) children.push(...bodyParagraphs(section.body))
    if (section.fields?.length) {
      const fieldTable = renderFields(section.fields)
      if (fieldTable) children.push(fieldTable)
    }
    if (section.bullets?.length) children.push(...bulletList(section.bullets))
    if (section.numbered?.length) children.push(...numberedList(section.numbered))
    for (const callout of section.callouts || []) {
      children.push(renderCallout(callout))
    }
    for (const table of section.tables || []) {
      children.push(...renderDataTable(table))
    }
  }

  const doc = new Document({
    creator: input.metadata.author || 'PeakUI',
    title: input.title,
    subject: input.metadata.subject,
    description: input.description,
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.LEFT,
        }],
      }],
    },
    sections: [{
      properties: {},
      footers: {
        default: new Footer({
          children: [
            paragraph(input.metadata.footer || 'Generated by PeakUI', {
              size: 18,
              color: COLORS.muted,
              alignment: AlignmentType.CENTER,
              spacingAfter: 0,
            }),
          ],
        }),
      },
      children,
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
