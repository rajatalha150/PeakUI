import { describe, expect, it } from 'vitest'
import { isSuccessfulTaxToolResponse } from './tax-tool-result'

describe('isSuccessfulTaxToolResponse', () => {
  it('accepts read-only catalog results without an artifact', () => {
    expect(isSuccessfulTaxToolResponse('list_forms', { success: true, action: 'list_forms', forms: [] }, false)).toBe(true)
    expect(isSuccessfulTaxToolResponse('inspect_form', { success: true, action: 'inspect_form', form: { formId: 'f1040' } }, false)).toBe(true)
  })

  it('rejects missing catalog data and PDF responses without an artifact', () => {
    expect(isSuccessfulTaxToolResponse('list_forms', { success: true, action: 'list_forms' }, false)).toBe(false)
    expect(isSuccessfulTaxToolResponse('inspect_form', { success: true, action: 'inspect_form', form: null }, false)).toBe(false)
    expect(isSuccessfulTaxToolResponse('fill_pdf_form', { success: true, action: 'fill_pdf_form' }, false)).toBe(false)
    expect(isSuccessfulTaxToolResponse('generate_review_pdf', { success: true, action: 'generate_review_pdf' }, true)).toBe(true)
  })
})
