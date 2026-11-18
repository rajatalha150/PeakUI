import { describe, expect, it } from 'vitest'
import path from 'path'
import { resolveIrsFormPath, getIrsFormsDir, detectIrsFormTaxYear, selectIrsFormFieldPage, type IrsFormDetail } from './irs-forms-catalog'

describe('resolveIrsFormPath', () => {
  const dir = path.resolve('/tmp/fake-irs-forms')

  it('resolves a valid formId to a pdf inside the dir', () => {
    expect(resolveIrsFormPath('f1040', dir)).toBe(path.join(dir, 'f1040.pdf'))
  })

  it('strips a trailing .pdf and still resolves', () => {
    expect(resolveIrsFormPath('f1040sd.pdf', dir)).toBe(path.join(dir, 'f1040sd.pdf'))
  })

  it('rejects path traversal attempts', () => {
    expect(resolveIrsFormPath('../etc/passwd', dir)).toBeNull()
    expect(resolveIrsFormPath('..', dir)).toBeNull()
    expect(resolveIrsFormPath('a/../b', dir)).toBeNull()
  })

  it('rejects absolute paths and empty input', () => {
    expect(resolveIrsFormPath('/etc/passwd', dir)).toBeNull()
    expect(resolveIrsFormPath('', dir)).toBeNull()
    expect(resolveIrsFormPath('   ', dir)).toBeNull()
  })

  it('rejects characters outside the allowed set', () => {
    expect(resolveIrsFormPath('f1040;rm -rf', dir)).toBeNull()
    expect(resolveIrsFormPath('f1040 sd', dir)).toBeNull()
  })
})

describe('getIrsFormsDir', () => {
  it('returns a non-empty absolute path', () => {
    const dir = getIrsFormsDir()
    expect(dir).toBeTruthy()
    expect(path.isAbsolute(dir)).toBe(true)
    expect(dir.endsWith('irs_forms')).toBe(true)
  })
})

describe('IRS form inspection', () => {
  const form: IrsFormDetail = {
    formId: 'f1040', filename: 'f1040.pdf', title: '1040', sizeBytes: 100,
    fieldCount: 140, pageCount: 2, formTaxYear: '2025', pageText: 'Page one labels', warnings: [],
    fields: Array.from({ length: 140 }, (_, i) => ({ name: `page1.field${i}`, type: 'text' })),
  }

  it('detects an explicitly printed annual tax year', () => {
    expect(detectIrsFormTaxYear('Form 1040 U.S. Individual Income Tax Return 2025\n')).toBe('2025')
    expect(detectIrsFormTaxYear('For calendar year 2024\n')).toBe('2024')
    expect(detectIrsFormTaxYear('Revision 2025, no tax year stated')).toBeNull()
  })

  it('pages every exact field name without repeating page text', () => {
    const first = selectIrsFormFieldPage(form)
    expect(first.fields).toHaveLength(60)
    expect(first.nextFieldOffset).toBe(60)
    const middle = selectIrsFormFieldPage(form, { fieldOffset: first.nextFieldOffset })
    expect(middle.fields).toHaveLength(60)
    expect(middle.pageText).toBe('')
    const last = selectIrsFormFieldPage(form, { fieldOffset: middle.nextFieldOffset })
    expect(last.fields).toHaveLength(20)
    expect(last.nextFieldOffset).toBeNull()
  })

  it('filters field names and caps the requested page size', () => {
    const page = selectIrsFormFieldPage(form, { fieldQuery: 'field13', fieldLimit: 1000 })
    expect(page.matchedFieldCount).toBe(11)
    expect(page.fields[0].name).toBe('page1.field13')
  })
})
