import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createWordCanvasArtifact } from '@/lib/word/word-artifacts'
import {
  normalizeWordDocumentInput,
  wordDocumentHasRenderableContent,
  type WordDocumentInput,
} from '@/lib/word/word-schema'
import { renderWordDocument } from '@/lib/word/word-renderer'
import { assertNonEmptyArtifactBytes, hasMeaningfulDocumentText, isPlaceholderDocumentText } from '@/lib/document-generation-guard'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-word-document'
  return clean.toLowerCase().endsWith('.docx') ? clean : `${clean}.docx`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'canvas.use'], {
    forbiddenMessage: 'Word document generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Word Document'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title)
    const normalized = normalizeWordDocumentInput({
      ...(body as Partial<WordDocumentInput>),
      title,
      filename,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!wordDocumentHasRenderableContent(normalized)) {
      if (hasMeaningfulDocumentText(normalized.description)) {
        normalized.content = normalized.description
      } else {
        return NextResponse.json({
          code: 'ARTIFACT_CONTENT_REQUIRED',
          error: 'Word document content is required. Provide prose, sections, fields, tables, or callouts; a title alone is not enough.',
          retryable: true,
        }, { status: 422 })
      }
    }
    if (isPlaceholderDocumentText(normalized.content)) {
      return NextResponse.json({
        code: 'ARTIFACT_CONTENT_REQUIRED',
        error: 'The Word document content was a recovery placeholder. Regenerate it with the actual requested content.',
        retryable: true,
      }, { status: 422 })
    }

    const documentBytes = await renderWordDocument(normalized)
    assertNonEmptyArtifactBytes(documentBytes, 'Word document', 128)
    const sourceContent = JSON.stringify(normalized, null, 2)
    const artifact = await prisma.$transaction(tx => createWordCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      documentBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-word',
      source: {
        name: filename.replace(/\.docx$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'word-source',
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
    console.error('[workspace-tool/word-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Word document generation failed',
    }, { status: 500 })
  }
}
