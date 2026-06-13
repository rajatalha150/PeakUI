import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { buildTaxReturnDraft } from '@/lib/tax/tax-packet'
import { fillTaxPdfForm, renderTaxReviewPdf } from '@/lib/tax/tax-pdf'
import { createPdfCanvasArtifact } from '@/lib/pdf/pdf-artifacts'

export const runtime = 'nodejs'
export const maxDuration = 120

type TaxAction = 'generate_review_pdf' | 'fill_pdf_form'

function normalizeAction(value: unknown): TaxAction {
  return value === 'fill_pdf_form' ? 'fill_pdf_form' : 'generate_review_pdf'
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'tax-return'
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'knowledge.use', 'canvas.use'], {
    forbiddenMessage: 'Tax PDF generation requires OpenClaw, Knowledge Base, and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const action = normalizeAction(body?.action)
    const folder = typeof body?.folder === 'string' && body.folder.trim() ? body.folder.trim() : null
    const taxYear = typeof body?.taxYear === 'string' && body.taxYear.trim() ? body.taxYear.trim() : null
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const templateDocumentId = typeof body?.templateDocumentId === 'string' && body.templateDocumentId.trim()
      ? body.templateDocumentId.trim()
      : null
    const flatten = body?.flatten === true

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
    const warnings = [...draft.warnings]

    if (action === 'fill_pdf_form') {
      if (!templateDocumentId) {
        return NextResponse.json({ error: 'templateDocumentId is required for fill_pdf_form' }, { status: 400 })
      }

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
          error: 'Template PDF bytes are not available. Re-upload the PDF after this update, or use generate_review_pdf.',
        }, { status: 400 })
      }

      const filled = await fillTaxPdfForm(Buffer.from(template.originalContent, 'base64'), draft, flatten)
      pdfBytes = filled.bytes
      outputKind = 'filled-form'
      filledFields = filled.filledFields
      warnings.push(...filled.warnings)
      if (filledFields.length === 0) {
        warnings.push('No matching AcroForm fields were detected in the template PDF.')
      }
    } else {
      pdfBytes = await renderTaxReviewPdf(draft)
    }

    const name = `${sanitizeFilename(`tax-${draft.taxYear}-${outputKind}`)}.pdf`
    const artifact = await prisma.$transaction(tx => createPdfCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name,
      pdfBytes,
      bundleName: `Tax ${draft.taxYear}`,
      bundleRole: outputKind,
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
