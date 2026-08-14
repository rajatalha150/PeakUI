import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createCsvCanvasArtifact } from '@/lib/csv/csv-artifacts'
import { normalizeCsvDocumentInput, ensureCsvRenderableContent, type CsvDocumentInput } from '@/lib/csv/csv-schema'
import { renderCsvDocument } from '@/lib/csv/csv-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-data'
  return clean.toLowerCase().endsWith('.csv') ? clean : `${clean}.csv`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'canvas.use'], {
    forbiddenMessage: 'CSV export requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated CSV'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title)
    const normalized = normalizeCsvDocumentInput({
      ...(body as Partial<CsvDocumentInput>),
      title,
      filename,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    ensureCsvRenderableContent(normalized)

    const csvBytes = renderCsvDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)

    const artifact = await prisma.$transaction(tx => createCsvCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      csvBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-csv',
      source: {
        name: filename.replace(/\.csv$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'csv-source',
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
    console.error('[openclaw/csv-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'CSV export failed',
    }, { status: 500 })
  }
}
