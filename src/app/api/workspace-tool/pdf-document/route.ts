import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createPdfCanvasArtifact } from '@/lib/pdf/pdf-artifacts'
import { normalizePdfDocumentInput, pdfDocumentHasRenderableContent, type PdfDocumentInput } from '@/lib/pdf/document-schema'
import { renderPdfDocument } from '@/lib/pdf/simple-pdf'
import { assertNonEmptyArtifactBytes, hasMeaningfulDocumentText, isPlaceholderDocumentText } from '@/lib/document-generation-guard'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-document'
  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'canvas.use'], {
    forbiddenMessage: 'PDF generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated PDF'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title)
    const normalized = normalizePdfDocumentInput({
      ...(body as Partial<PdfDocumentInput>),
      title,
      filename,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!pdfDocumentHasRenderableContent(normalized)) {
      if (hasMeaningfulDocumentText(normalized.description)) {
        normalized.content = normalized.description
      } else {
        return NextResponse.json({
          code: 'ARTIFACT_CONTENT_REQUIRED',
          error: 'PDF content is required. Provide prose, sections, fields, tables, or callouts; a title alone is not enough.',
          retryable: true,
        }, { status: 422 })
      }
    }
    if (isPlaceholderDocumentText(normalized.content)) {
      return NextResponse.json({
        code: 'ARTIFACT_CONTENT_REQUIRED',
        error: 'The PDF content was a recovery placeholder. Regenerate it with the actual requested content.',
        retryable: true,
      }, { status: 422 })
    }
    if (normalized.content.length > 60_000) {
      return NextResponse.json({ error: 'PDF content is too large for a single generated document' }, { status: 413 })
    }

    const pdfBytes = await renderPdfDocument(normalized)
    assertNonEmptyArtifactBytes(pdfBytes, 'PDF', 64)
    const sourceContent = JSON.stringify(normalized, null, 2)

    const artifact = await prisma.$transaction(tx => createPdfCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      pdfBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-pdf',
      source: {
        name: filename.replace(/\.pdf$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'pdf-source',
      },
    }))

    return NextResponse.json({
      success: true,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
        downloadUrl: `/api/canvas/artifacts/${artifact.id}/download`,
      },
    })
  } catch (error) {
    console.error('[workspace-tool/pdf-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'PDF generation failed',
    }, { status: 500 })
  }
}
