import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createArchiveCanvasArtifact } from '@/lib/archive/archive-artifacts'
import {
  normalizeArchiveDocumentInput,
  archiveDocumentHasRenderableContent,
} from '@/lib/archive/archive-schema'
import { renderArchiveDocument } from '@/lib/archive/archive-renderer'
import { assertNonEmptyArtifactBytes } from '@/lib/document-generation-guard'
import { deliverDocumentToWorkspace } from '@/lib/workspace-document-delivery'

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
    assertNonEmptyArtifactBytes(archiveBytes, 'Archive', 32)
    const sourceContent = JSON.stringify(normalized, null, 2)

    
    // Deliver the file into the selected workspace so it appears in the Files
    // panel — the Canvas artifact alone left the file tree empty. Best-effort.
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : null
    const delivery = await deliverDocumentToWorkspace({
      userId: access.userId,
      sessionId,
      workspaceId,
      filename: filename.toLowerCase().endsWith('.zip') ? filename : `${filename}.zip`,
      bytes: archiveBytes,
    })

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
      ...(delivery.ok && delivery.hostPath
        ? { workspaceFile: { path: delivery.hostPath, note: 'The file was also saved into the selected workspace and is visible in the Files panel.' } }
        : { workspaceFileError: delivery.error || 'The file could not be saved into the workspace; use the download link.' }),
    })
  } catch (error) {
    console.error('[workspace-tool/archive-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Archive generation failed',
    }, { status: 500 })
  }
}
