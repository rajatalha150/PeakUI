import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { buildTaxReturnDraft } from '@/lib/tax/tax-packet'
import { fillTaxPdfForm, renderTaxReviewPdf } from '@/lib/tax/tax-pdf'
import { createPdfCanvasArtifact } from '@/lib/pdf/pdf-artifacts'
import { normalizeFolderPath } from '@/lib/kb-folders'
import { listIrsForms, inspectIrsForm, inspectIrsFormPageText, loadIrsFormPdf, selectIrsFormFieldPage } from '@/lib/tax/irs-forms-catalog'

export const runtime = 'nodejs'
export const maxDuration = 120

type TaxAction = 'generate_review_pdf' | 'fill_pdf_form' | 'list_forms' | 'inspect_form'

const READ_ONLY_ACTIONS: ReadonlySet<TaxAction> = new Set(['list_forms', 'inspect_form'])

function normalizeAction(value: unknown): TaxAction | null {
  if (value === 'fill_pdf_form') return 'fill_pdf_form'
  if (value === 'list_forms') return 'list_forms'
  if (value === 'inspect_form') return 'inspect_form'
  if (value === 'generate_review_pdf') return 'generate_review_pdf'
  return null
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'tax-return'
}

function normalizeFields(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields: Record<string, string> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim() && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null)) {
      fields[key.trim()] = val === null ? '' : String(val)
    }
  }
  return Object.keys(fields).length > 0 ? fields : null
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = normalizeAction(body?.action)
  if (!action) return NextResponse.json({ error: 'A valid tax action is required.' }, { status: 400 })
  const readOnly = READ_ONLY_ACTIONS.has(action)

  // list_forms / inspect_form only read the public IRS form catalog; they do
  // not touch the Knowledge Base or create Canvas artifacts, so they need only
  // WorkSpaces access. fill/review read KB client data and write an artifact.
  const access = await requireCurrentAuthWithPermissions(
    readOnly ? ['workspace-tool.use'] : ['workspace-tool.use', 'knowledge.use', 'canvas.use'],
    {
      forbiddenMessage: readOnly
        ? 'IRS form catalog access requires WorkSpaces permission.'
        : 'Tax PDF generation requires WorkSpaces, Knowledge Base, and Canvas permissions.',
    },
  )
  if ('response' in access) return access.response

  try {
    const folder = normalizeFolderPath(typeof body?.folder === 'string' ? body.folder : null) || null
    const taxYear = typeof body?.taxYear === 'string' && body.taxYear.trim() ? body.taxYear.trim() : null
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const templateDocumentId = typeof body?.templateDocumentId === 'string' && body.templateDocumentId.trim()
      ? body.templateDocumentId.trim()
      : null
    const formId = typeof body?.formId === 'string' && body.formId.trim() ? body.formId.trim() : null
    const fieldsOverlay = normalizeFields(body?.fields)
    const flatten = body?.flatten === true

    // Read-only catalog actions: no session/artifact required.
    if (action === 'list_forms') {
      const forms = await listIrsForms()
      return NextResponse.json({ success: true, action, forms })
    }
    if (action === 'inspect_form') {
      if (!formId) {
        return NextResponse.json({ error: 'formId is required for inspect_form' }, { status: 400 })
      }
      let form
      try {
        form = await inspectIrsForm(formId)
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'IRS form not found.' }, { status: 400 })
      }
      const pageNumber = typeof body?.pageNumber === 'number' && Number.isInteger(body.pageNumber) ? body.pageNumber : 1
      if (pageNumber < 1 || pageNumber > form.pageCount) {
        return NextResponse.json({ error: `pageNumber must be between 1 and ${form.pageCount}.` }, { status: 400 })
      }
      const fieldPage = selectIrsFormFieldPage(form, {
        fieldOffset: body?.fieldOffset,
        fieldLimit: body?.fieldLimit,
        fieldQuery: body?.fieldQuery,
      })
      return NextResponse.json({
        success: true,
        action,
        form: {
          ...fieldPage,
          pageNumber,
          pageText: pageNumber > 1 ? await inspectIrsFormPageText(formId, pageNumber) : fieldPage.pageText,
        },
      })
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!folder) {
      return NextResponse.json({ error: 'Select a client Knowledge Base folder before generating a tax PDF.' }, { status: 400 })
    }
    if (!taxYear || !/^20\d{2}$/.test(taxYear)) {
      return NextResponse.json({ error: 'An explicit four-digit taxYear is required for a tax PDF.' }, { status: 400 })
    }
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId: access.userId, surface: 'workspace-tool' },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'WorkSpaces session not found.' }, { status: 404 })

    const draft = await buildTaxReturnDraft({
      userId: access.userId,
      folder,
      taxYear,
    })
    if (draft.sourceDocumentIds.length === 0) {
      return NextResponse.json({ error: 'No ready tax documents were found in the selected Knowledge Base folder.' }, { status: 400 })
    }

    let pdfBytes: Buffer
    let outputKind = 'review'
    let filledFields: string[] = []
    let sourceTemplateId: string | null = null
    const warnings = [...draft.warnings]

    if (action === 'fill_pdf_form') {
      let templateBytes: Buffer | null = null

      if (formId) {
        // Fill an official IRS form from the bundled catalog.
        try {
          const form = await inspectIrsForm(formId)
          if (form.formTaxYear && form.formTaxYear !== taxYear) {
            return NextResponse.json({
              error: `The bundled ${formId} form is for tax year ${form.formTaxYear}, not ${taxYear}. Choose a matching form before filling.`,
            }, { status: 400 })
          }
          if (form.fieldCount === 0) {
            return NextResponse.json({ error: `The bundled ${formId} PDF has no fillable fields. Use a fillable template for this form.` }, { status: 422 })
          }
          templateBytes = await loadIrsFormPdf(formId)
        } catch (error) {
          return NextResponse.json({
            error: error instanceof Error ? error.message : `IRS form not found: ${formId}`,
          }, { status: 400 })
        }
      } else if (templateDocumentId) {
        // Fill an uploaded template PDF from the Knowledge Base.
        const template = await prisma.document.findFirst({
          where: { id: templateDocumentId, userId: access.userId },
          select: {
            id: true,
            filename: true,
            originalContent: true,
            originalMimeType: true,
          },
        })

        if (!template?.originalContent) {
          return NextResponse.json({
            error: 'Template PDF bytes are not available. Re-upload the PDF after this update, use generate_review_pdf, or pass a formId for an official IRS form.',
          }, { status: 400 })
        }

        templateBytes = Buffer.from(template.originalContent, 'base64')
        sourceTemplateId = template.id
      } else {
        return NextResponse.json({
          error: 'fill_pdf_form requires either a formId (official IRS form) or a templateDocumentId (uploaded template).',
        }, { status: 400 })
      }

      let filled
      try {
        filled = await fillTaxPdfForm(templateBytes, draft, flatten, fieldsOverlay || undefined)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not fill this PDF.'
        if (/no fillable AcroForm fields/i.test(message)) {
          return NextResponse.json({ error: message }, { status: 422 })
        }
        throw error
      }
      pdfBytes = filled.bytes
      outputKind = formId ? `filled-${formId}` : 'filled-form'
      filledFields = filled.filledFields
      warnings.push(...filled.warnings)
      if (filledFields.length === 0) {
        return NextResponse.json({
          error: 'No form fields were filled. Call inspect_form to get exact field names and supply supported values.',
          warnings,
        }, { status: 422 })
      }
    } else {
      pdfBytes = await renderTaxReviewPdf(draft)
    }

    const name = `${sanitizeFilename(`tax-${draft.taxYear}-${outputKind}`)}.pdf`
    // For fill_pdf_form against an uploaded template, link the filled PDF back
    // to the source template so the new artifact's lineage (sourceArtifactId)
    // records which PDF it was derived from.
    const sourceArtifactId = action === 'fill_pdf_form' && sourceTemplateId ? sourceTemplateId : null
    const artifact = await prisma.$transaction(tx => createPdfCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name,
      pdfBytes,
      bundleName: `Tax ${draft.taxYear}`,
      bundleRole: outputKind,
      ...(sourceArtifactId ? { sourceArtifactId } : {}),
    }))

    return NextResponse.json({
      success: true,
      action,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
        downloadUrl: `/api/canvas/artifacts/${artifact.id}/download`,
      },
      draft,
      filledFields,
      warnings,
    })
  } catch (error) {
    console.error('[workspace-tool/tax] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Tax PDF generation failed',
    }, { status: 500 })
  }
}
