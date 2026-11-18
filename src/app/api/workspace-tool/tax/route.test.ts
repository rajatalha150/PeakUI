import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findSession: vi.fn(),
  buildDraft: vi.fn(),
  listForms: vi.fn(),
  inspectForm: vi.fn(),
  inspectPage: vi.fn(),
  loadForm: vi.fn(),
  fillForm: vi.fn(),
  renderReview: vi.fn(),
  createArtifact: vi.fn(),
}))

vi.mock('@/lib/request-auth', () => ({ requireCurrentAuthWithPermissions: mocks.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatSession: { findFirst: mocks.findSession },
    $transaction: (callback: (tx: object) => unknown) => callback({}),
  },
}))
vi.mock('@/lib/tax/tax-packet', () => ({ buildTaxReturnDraft: mocks.buildDraft }))
vi.mock('@/lib/tax/tax-pdf', () => ({ fillTaxPdfForm: mocks.fillForm, renderTaxReviewPdf: mocks.renderReview }))
vi.mock('@/lib/pdf/pdf-artifacts', () => ({ createPdfCanvasArtifact: mocks.createArtifact }))
vi.mock('@/lib/tax/irs-forms-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/tax/irs-forms-catalog')>(),
  listIrsForms: mocks.listForms,
  inspectIrsForm: mocks.inspectForm,
  inspectIrsFormPageText: mocks.inspectPage,
  loadIrsFormPdf: mocks.loadForm,
}))

function request(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/workspace-tool/tax', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as NextRequest
}

const draft = { taxYear: '2025', folder: 'client-a/2025', sourceDocumentIds: ['doc-1'], warnings: [], missingFields: [] }
const form = {
  formId: 'f1040', filename: 'f1040.pdf', title: 'Form 1040', sizeBytes: 100,
  fieldCount: 120, pageCount: 2, formTaxYear: '2025', pageText: 'Page one labels', warnings: [],
  fields: Array.from({ length: 120 }, (_, i) => ({ name: `f1_${i}`, type: 'text' })),
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.auth.mockResolvedValue({ userId: 'user-1' })
  mocks.findSession.mockResolvedValue({ id: 'session-1' })
  mocks.buildDraft.mockResolvedValue(draft)
  mocks.listForms.mockResolvedValue([])
  mocks.inspectForm.mockResolvedValue(form)
  mocks.inspectPage.mockResolvedValue('Page two labels')
  mocks.loadForm.mockResolvedValue(Buffer.from('pdf'))
  mocks.fillForm.mockResolvedValue({ bytes: Buffer.from('filled'), filledFields: ['f1_0'], warnings: [] })
  mocks.renderReview.mockResolvedValue(Buffer.from('review'))
  mocks.createArtifact.mockResolvedValue({ id: 'artifact-1', name: 'tax.pdf', mimeType: 'application/pdf', size: 6 })
})

describe('WorkSpaces tax route', () => {
  it('rejects unknown actions instead of silently generating a review PDF', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ action: 'wrong' }))
    expect(response.status).toBe(400)
    expect(mocks.buildDraft).not.toHaveBeenCalled()
  })

  it('returns a bounded catalog page with a path to every field and PDF page', async () => {
    const { POST } = await import('./route')
    const response = await POST(request({ action: 'inspect_form', formId: 'f1040', fieldOffset: 60, pageNumber: 2 }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.form.fields).toHaveLength(60)
    expect(data.form.nextFieldOffset).toBeNull()
    expect(data.form.pageText).toBe('Page two labels')
    expect(data.form.formTaxYear).toBe('2025')
    expect(mocks.buildDraft).not.toHaveBeenCalled()
  })

  it('requires a client folder, explicit year, and owned WorkSpaces session', async () => {
    const { POST } = await import('./route')
    const base = { action: 'generate_review_pdf', sessionId: 'session-1' }
    expect((await POST(request(base))).status).toBe(400)
    expect((await POST(request({ ...base, folder: 'client-a/2025' }))).status).toBe(400)
    mocks.findSession.mockResolvedValueOnce(null)
    expect((await POST(request({ ...base, folder: 'client-a/2025', taxYear: '2025' }))).status).toBe(404)
    expect(mocks.buildDraft).not.toHaveBeenCalled()
  })

  it('refuses an empty client folder and a mismatched bundled form year', async () => {
    const { POST } = await import('./route')
    const base = { action: 'fill_pdf_form', sessionId: 'session-1', folder: 'client-a/2025', taxYear: '2025', formId: 'f1040' }
    mocks.buildDraft.mockResolvedValueOnce({ ...draft, sourceDocumentIds: [] })
    expect((await POST(request(base))).status).toBe(400)
    mocks.inspectForm.mockResolvedValueOnce({ ...form, formTaxYear: '2024' })
    const mismatch = await POST(request(base))
    expect(mismatch.status).toBe(400)
    expect((await mismatch.json()).error).toContain('2024')
    expect(mocks.loadForm).not.toHaveBeenCalled()
  })

  it('does not publish a PDF when no fields were filled', async () => {
    const { POST } = await import('./route')
    mocks.fillForm.mockResolvedValueOnce({ bytes: Buffer.from('pdf'), filledFields: [], warnings: [] })
    const response = await POST(request({ action: 'fill_pdf_form', sessionId: 'session-1', folder: 'client-a/2025', taxYear: '2025', formId: 'f1040' }))
    expect(response.status).toBe(422)
    expect(mocks.createArtifact).not.toHaveBeenCalled()
  })
})
