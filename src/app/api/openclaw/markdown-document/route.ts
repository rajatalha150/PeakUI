import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createMarkdownCanvasArtifact } from '@/lib/markdown/markdown-artifacts'
import {
  normalizeMarkdownDocumentInput,
  markdownDocumentHasRenderableContent,
  type MarkdownDocumentInput,
} from '@/lib/markdown/markdown-schema'
import { renderMarkdownDocument } from '@/lib/markdown/markdown-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-markdown'
  return clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'canvas.use'], {
    forbiddenMessage: 'Markdown document generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Markdown Document'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title)
    const content = typeof body?.content === 'string' ? body.content : ''
    const normalized = normalizeMarkdownDocumentInput({
      ...(body as Partial<MarkdownDocumentInput>),
      title,
      filename,
      content,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!markdownDocumentHasRenderableContent(normalized)) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const markdownBytes = renderMarkdownDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)
    const artifact = await prisma.$transaction(tx => createMarkdownCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      markdownBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-markdown',
      source: {
        name: filename.replace(/\.md$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'markdown-source',
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
    console.error('[openclaw/markdown-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Markdown document generation failed',
    }, { status: 500 })
  }
}
