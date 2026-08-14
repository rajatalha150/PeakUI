import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createWorkbookCanvasArtifact } from '@/lib/workbook/workbook-artifacts'
import {
  normalizeWorkbookDocumentInput,
  ensureWorkbookRenderableContent,
  type WorkbookDocumentInput,
} from '@/lib/workbook/workbook-schema'
import { renderWorkbookDocument } from '@/lib/workbook/workbook-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-workbook'
  return clean.toLowerCase().endsWith('.xlsx') ? clean : `${clean}.xlsx`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'canvas.use'], {
    forbiddenMessage: 'Workbook generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Workbook'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title)
    const normalized = normalizeWorkbookDocumentInput({
      ...(body as Partial<WorkbookDocumentInput>),
      title,
      filename,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    ensureWorkbookRenderableContent(normalized)

    const workbookBytes = await renderWorkbookDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)
    const artifact = await prisma.$transaction(tx => createWorkbookCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      workbookBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-workbook',
      source: {
        name: filename.replace(/\.xlsx$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'workbook-source',
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
    console.error('[openclaw/workbook-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Workbook generation failed',
    }, { status: 500 })
  }
}
