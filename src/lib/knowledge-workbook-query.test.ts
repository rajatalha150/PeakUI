import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('full workbook monthly average', () => {
  it('uses the requested month window and counts distinct permit IDs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'peakui-monthly-'))
    const file = join(dir, 'permits.xlsx')
    try {
      const book = new ExcelJS.Workbook()
      const sheet = book.addWorksheet('Data')
      sheet.addRow(['PermitNumber', 'ApplicationTrackingID', 'PermitIssueDate', 'PermitteeName'])
      sheet.addRow(['old', '2021120100000001', 2021, 'Alpha'])
      for (let i = 0; i < 6; i++) sheet.addRow([`jan-${i}`, `202201${String(i + 1).padStart(2, '0')}00000001`, 2022, 'Alpha'])
      sheet.addRow(['jan-0', '2022010100000001', 2022, 'Alpha'])
      for (let i = 0; i < 6; i++) sheet.addRow([`feb-${i}`, `202202${String(i + 1).padStart(2, '0')}00000001`, 2022, 'Alpha'])
      sheet.addRow(['other', '2022020100000002', 2022, 'Beta'])
      await book.xlsx.writeFile(file)
      const { stdout } = await run('node', [join(process.cwd(), 'scripts/knowledge-workbook-query.mjs'), file,
        'PermitteeName', 'ApplicationTrackingID', 'PermitNumber', '3', '0', '100', '2022-01', '2022-03'])
      const result = JSON.parse(stdout)
      expect(result.monthsInWindow).toBe(3)
      expect(result.excludedOutOfRange).toBe(1)
      expect(result.qualifyingCompanies).toBe(1)
      expect(result.results[0]).toMatchObject({ company: 'Alpha', permits: 12, monthlyAverage: 4 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
