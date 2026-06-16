import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { normalizeWorkbookDocumentInput } from './workbook-schema'
import { renderWorkbookDocument } from './workbook-renderer'

describe('renderWorkbookDocument', () => {
  it('creates a valid XLSX workbook from structured sheets', async () => {
    const normalized = normalizeWorkbookDocumentInput({
      title: 'Budget Workbook',
      template: 'budget',
      sheets: [{
        name: 'Budget',
        title: 'Budget',
        columns: [
          { header: 'Category', type: 'text' },
          { header: 'Planned', type: 'currency' },
          { header: 'Actual', type: 'currency' },
        ],
        rows: [
          { Category: 'Hosting', Planned: 500, Actual: 425 },
          { Category: 'Support', Planned: 1200, Actual: 1100 },
        ],
        tables: [{
          title: 'Summary',
          columns: [
            { header: 'Metric', type: 'text' },
            { header: 'Amount', type: 'currency' },
          ],
          rows: [{ Metric: 'Total Actual', Amount: 1525 }],
          totals: [{ label: 'Total', column: 'Amount', formula: 'sum' }],
        }],
      }],
      metadata: { currency: 'USD' },
    })

    const buffer = await renderWorkbookDocument(normalized)
    expect(buffer.byteLength).toBeGreaterThan(1000)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const worksheet = workbook.getWorksheet('Budget')
    expect(worksheet).toBeTruthy()
    expect(worksheet?.getCell('A1').value).toBe('Budget')
    expect(worksheet?.rowCount).toBeGreaterThan(3)
  })
})
