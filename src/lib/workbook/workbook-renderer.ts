import ExcelJS from 'exceljs'
import type {
  NormalizedWorkbookDocument,
  WorkbookColumn,
  WorkbookTable,
} from './workbook-schema'

const HEADER_FILL = 'FF1F2937'
const HEADER_FONT = 'FFFFFFFF'
const TITLE_FILL = 'FFEFF6FF'
const BORDER_COLOR = 'FFE5E7EB'

function columnLetter(index: number): string {
  let value = index
  let letter = ''
  while (value > 0) {
    const mod = (value - 1) % 26
    letter = String.fromCharCode(65 + mod) + letter
    value = Math.floor((value - mod) / 26)
  }
  return letter
}

function safeSheetName(name: string): string {
  return name.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
}

function cellValueForRow(row: WorkbookTable['rows'][number], column: WorkbookColumn, columnIndex: number) {
  if (Array.isArray(row)) return row[columnIndex] ?? null
  return row[column.key || column.header] ?? row[column.header] ?? null
}

function numberFormatForColumn(column: WorkbookColumn, currency: string): string | undefined {
  if (column.type === 'currency') return `${currency === 'USD' ? '$' : currency + ' '}#,##0.00`
  if (column.type === 'number') return '#,##0.00'
  if (column.type === 'percent') return '0.00%'
  if (column.type === 'date') return 'm/d/yyyy'
  return undefined
}

function coerceValue(value: unknown, column: WorkbookColumn): ExcelJS.CellValue {
  if (value === null || value === undefined) return null
  if (column.type === 'number' || column.type === 'currency' || column.type === 'percent') {
    if (typeof value === 'number') return value
    const parsed = Number(String(value).replace(/[$,%\s,]/g, ''))
    return Number.isFinite(parsed) ? (column.type === 'percent' && parsed > 1 ? parsed / 100 : parsed) : String(value)
  }
  if (column.type === 'date') {
    const date = value instanceof Date ? value : new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : date
  }
  return value as ExcelJS.CellValue
}

function computeTotal(rows: WorkbookTable['rows'], column: WorkbookColumn, formula: NonNullable<WorkbookTable['totals']>[number]['formula']): number | null {
  const values = rows.flatMap(row => {
    const value = cellValueForRow(row, column, 0)
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,%\s,]/g, ''))
    return Number.isFinite(parsed) ? [parsed] : []
  })
  if (values.length === 0) return null
  if (formula === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length
  if (formula === 'count') return values.length
  if (formula === 'min') return Math.min(...values)
  if (formula === 'max') return Math.max(...values)
  return values.reduce((sum, value) => sum + value, 0)
}

function styleRow(row: ExcelJS.Row, options: { fill?: string; fontColor?: string; bold?: boolean }) {
  row.eachCell(cell => {
    cell.font = { bold: options.bold, color: options.fontColor ? { argb: options.fontColor } : undefined }
    if (options.fill) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.fill } }
    }
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    }
  })
}

function addTableToWorksheet(input: {
  worksheet: ExcelJS.Worksheet
  table: WorkbookTable
  startRow: number
  currency: string
}) {
  const { worksheet, table, startRow, currency } = input
  let rowIndex = startRow

  if (table.title) {
    const titleRow = worksheet.getRow(rowIndex)
    titleRow.getCell(1).value = table.title
    titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF111827' } }
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } }
    worksheet.mergeCells(rowIndex, 1, rowIndex, Math.max(1, table.columns.length))
    rowIndex += 1
  }

  const headerRow = worksheet.getRow(rowIndex)
  table.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = column.header
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  styleRow(headerRow, { fill: HEADER_FILL, fontColor: HEADER_FONT, bold: true })
  const headerRowIndex = rowIndex
  rowIndex += 1

  table.rows.forEach(row => {
    const excelRow = worksheet.getRow(rowIndex)
    table.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1)
      cell.value = coerceValue(cellValueForRow(row, column, columnIndex), column)
      cell.alignment = { vertical: 'top', wrapText: true }
      const numFmt = numberFormatForColumn(column, currency)
      if (numFmt) cell.numFmt = numFmt
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } },
      }
    })
    rowIndex += 1
  })

  const lastDataRow = rowIndex - 1
  if (table.totals && table.totals.length > 0) {
    for (const total of table.totals) {
      const totalRow = worksheet.getRow(rowIndex)
      totalRow.getCell(1).value = total.label
      totalRow.getCell(1).font = { bold: true }
      const targetColumnIndex = table.columns.findIndex(column => (column.key || column.header) === total.column || column.header === total.column)
      if (targetColumnIndex >= 0) {
        const targetCell = totalRow.getCell(targetColumnIndex + 1)
        const letter = columnLetter(targetColumnIndex + 1)
        const formulaName = total.formula === 'average' ? 'AVERAGE'
          : total.formula === 'count' ? 'COUNT'
            : total.formula === 'min' ? 'MIN'
              : total.formula === 'max' ? 'MAX'
                : 'SUM'
        const result = total.value ?? computeTotal(table.rows, table.columns[targetColumnIndex], total.formula || 'sum') ?? undefined
        targetCell.value = { formula: `${formulaName}(${letter}${headerRowIndex + 1}:${letter}${lastDataRow})`, result }
        targetCell.font = { bold: true }
        const numFmt = numberFormatForColumn(table.columns[targetColumnIndex], currency)
        if (numFmt) targetCell.numFmt = numFmt
      }
      styleRow(totalRow, { fill: 'FFF9FAFB', bold: true })
      rowIndex += 1
    }
  }

  const lastColumn = table.columns.length
  if (lastDataRow >= headerRowIndex && lastColumn > 0) {
    worksheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: Math.max(headerRowIndex, lastDataRow), column: lastColumn },
    }
  }

  table.columns.forEach((column, index) => {
    const values = table.rows.map(row => String(cellValueForRow(row, column, index) ?? ''))
    const maxLength = Math.max(column.header.length, ...values.slice(0, 100).map(value => value.length))
    worksheet.getColumn(index + 1).width = column.width || Math.max(10, Math.min(36, maxLength + 2))
  })

  return rowIndex + 1
}

export async function renderWorkbookDocument(input: NormalizedWorkbookDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = input.metadata.creator || 'PeakUI'
  workbook.lastModifiedBy = 'PeakUI'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.subject = input.metadata.subject || input.title
  workbook.title = input.title
  if (input.metadata.company) workbook.company = input.metadata.company

  for (const sheet of input.sheets) {
    const worksheet = workbook.addWorksheet(safeSheetName(sheet.name), {
      views: sheet.freezeHeader === false ? [] : [{ state: 'frozen', ySplit: 2 }],
      properties: { defaultRowHeight: 18 },
    })
    let rowIndex = 1

    const titleRow = worksheet.getRow(rowIndex)
    titleRow.getCell(1).value = sheet.title || input.title
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF111827' } }
    titleRow.height = 24
    worksheet.mergeCells(rowIndex, 1, rowIndex, Math.max(1, sheet.tables?.[0]?.columns.length || 4))
    rowIndex += 1

    if (sheet.subtitle) {
      const subtitleRow = worksheet.getRow(rowIndex)
      subtitleRow.getCell(1).value = sheet.subtitle
      subtitleRow.getCell(1).font = { italic: true, color: { argb: 'FF4B5563' } }
      worksheet.mergeCells(rowIndex, 1, rowIndex, Math.max(1, sheet.tables?.[0]?.columns.length || 4))
      rowIndex += 2
    }

    for (const table of sheet.tables || []) {
      rowIndex = addTableToWorksheet({ worksheet, table, startRow: rowIndex, currency: input.metadata.currency })
    }

    if (sheet.notes?.length) {
      const notesHeader = worksheet.getRow(rowIndex)
      notesHeader.getCell(1).value = 'Notes'
      notesHeader.getCell(1).font = { bold: true }
      rowIndex += 1
      for (const note of sheet.notes) {
        worksheet.getRow(rowIndex).getCell(1).value = note
        rowIndex += 1
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
