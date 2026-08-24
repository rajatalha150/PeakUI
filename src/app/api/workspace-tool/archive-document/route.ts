import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createArchiveCanvasArtifact } from '@/lib/archive/archive-artifacts'
import {
  normalizeArchiveDocumentInput,
  archiveDocumentHasRenderableContent,
} from '@/lib/archive/archive-schema'
import { renderArchiveDocument } from '@/lib/archive/archive-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-archive'
  return clean.toLowerCase().endsWith('.zip') ? clean : `${clean}.zip`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'canvas.use'], {
    forbiddenMessage: 'Archive generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Archive'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(
      typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title,
    )

    const normalized = normalizeArchiveDocumentInput({
      title,
      filename,
      entries: Array.isArray(body?.entries) ? body.entries : [],
      description: typeof body?.description === 'string' ? body.description : undefined,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!archiveDocumentHasRenderableContent(normalized)) {
      return NextResponse.json({ error: 'At least one entry is required' }, { status: 400 })
    }

    const archiveBytes = await renderArchiveDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)

    const artifact = await prisma.$transaction(tx => createArchiveCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      archiveBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-archive',
      source: {
        name: filename.replace(/\.zip$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'archive-source',
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
    console.error('[workspace-tool/archive-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Archive generation failed',
    }, { status: 500 })
  }
}