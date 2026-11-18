export type TaxToolAction = 'list_forms' | 'inspect_form' | 'fill_pdf_form' | 'generate_review_pdf'

/** Catalog lookups succeed without a Canvas artifact; PDF actions require one. */
export function isSuccessfulTaxToolResponse(
  action: TaxToolAction,
  data: Record<string, unknown>,
  hasUsableArtifact: boolean,
): boolean {
  if (data.success !== true || data.action !== action) return false
  if (action === 'list_forms') return Array.isArray(data.forms)
  if (action === 'inspect_form') {
    const form = data.form
    return typeof form === 'object' && form !== null && !Array.isArray(form)
      && typeof (form as Record<string, unknown>).formId === 'string'
  }
  return hasUsableArtifact
}
