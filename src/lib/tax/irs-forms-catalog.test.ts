import { describe, expect, it } from 'vitest'
import path from 'path'
import { resolveIrsFormPath, getIrsFormsDir } from './irs-forms-catalog'

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