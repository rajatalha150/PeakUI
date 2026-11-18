import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { readWorkbookChunks } from './rag-workbook-index'

describe('streaming workbook indexing', () => {
  it('includes rows beyond 200, columns beyond 30, and every sheet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'peakui-workbook-'))
    const path = join(dir, 'large.xlsx')
    try {
      const workbook = new ExcelJS.Workbook()
      const permits = workbook.addWorksheet('Permits')
      for (let row = 1; row <= 250; row++) {
        permits.getCell(`A${row}`).value = `permit-${row}`
        permits.getCell(`AI${row}`).value = `district-${row}`
      }
      workbook.addWorksheet('Second sheet').getCell('B1').value = 'second-sheet-value'
      await workbook.xlsx.writeFile(path)

      const chunks: string[] = []
      for await (const chunk of readWorkbookChunks(path)) chunks.push(chunk.content)
      const text = chunks.join('\n')
      expect(text).toContain('Sheet: Permits')
      expect(text).toContain('Sheet: Second sheet')
      expect(text).toContain('permit-250')
      expect(text).toContain('AI=district-250')
      expect(text).toContain('second-sheet-value')
      expect(text).toContain('Rows: 1-')
      expect(chunks.every(chunk => chunk.length < 2500)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)
})
