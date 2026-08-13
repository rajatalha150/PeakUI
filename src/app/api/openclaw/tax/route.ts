import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { buildTaxReturnDraft } from '@/lib/tax/tax-packet'
import { fillTaxPdfForm, renderTaxReviewPdf } from '@/lib/tax/tax-pdf'
import { createPdfCanvasArtifact } from '@/lib/pdf/pdf-artifacts'
import { listIrsForms, inspectIrsForm, loadIrsFormPdf } from '@/lib/tax/irs-forms-catalog'

export const runtime = 'nodejs'
export const maxDuration = 120

type TaxAction = 'generate_review_pdf' | 'fill_pdf_form' | 'list_forms' | 'inspect_form'

const READ_ONLY_ACTIONS: ReadonlySet<TaxAction> = new Set(['list_forms', 'inspect_form'])

function normalizeAction(value: unknown): TaxAction {
  if (value === 'fill_pdf_form') return 'fill_pdf_form'
  if (value === 'list_forms') return 'list_forms'
  if (value === 'inspect_form') return 'inspect_form'
  return 'generate_review_pdf'
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'tax-return'
}

function normalizeFields(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields: Record<string, string> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim() && (typeof val === 'string' || typeof val === 'number')) {
      fields[key.trim()] = String(val)
    }
  }
  return Object.keys(fields).length > 0 ? fields : null
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = normalizeAction(body?.action)
  const readOnly = READ_ONLY_ACTIONS.has(action)

  // list_forms / inspect_form only read the public IRS form catalog; they do
  // not touch the Knowledge Base or create Canvas artifacts, so they need only
  // WorkSpaces access. fill/review read KB client data and write an artifact.
  const access = await requireCurrentAuthWithPermissions(
    readOnly ? ['openclaw.use'] : ['openclaw.use', 'knowledge.use', 'canvas.use'],
    {
      forbiddenMessage: readOnly
        ? 'IRS form catalog access requires WorkSpaces permission.'
        : 'Tax PDF generation requires WorkSpaces, Knowledge Base, and Canvas permissions.',
    },
  )
  if ('response' in access) return access.response

  try {
    const folder = typeof body?.folder === 'string' && body.folder.trim() ? body.folder.trim() : null
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
      const form = await inspectIrsForm(formId)
      return NextResponse.json({ success: true, action, form })
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const draft = await buildTaxReturnDraft({
      userId: access.userId,
      folder,
      taxYear,
    })

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

      const filled = await fillTaxPdfForm(templateBytes, draft, flatten, fieldsOverlay || undefined)
      pdfBytes = filled.bytes
      outputKind = formId ? `filled-${formId}` : 'filled-form'
      filledFields = filled.filledFields
      warnings.push(...filled.warnings)
      if (filledFields.length === 0) {
        warnings.push('No matching AcroForm fields were filled. Call inspect_form to confirm the field names for this form.')
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
    console.error('[openclaw/tax] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Tax PDF generation failed',
    }, { status: 500 })
  }
}
