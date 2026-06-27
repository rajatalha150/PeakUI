import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createSlidesCanvasArtifact } from '@/lib/slides/slides-artifacts'
import {
  normalizeSlidesDocumentInput,
  slidesDocumentHasRenderableContent,
} from '@/lib/slides/slides-schema'
import { renderSlidesDocument } from '@/lib/slides/slides-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-deck'
  return clean.toLowerCase().endsWith('.pptx') ? clean : `${clean}.pptx`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'canvas.use'], {
    forbiddenMessage: 'Slide deck generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Slides'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(
      typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title,
    )

    const normalized = normalizeSlidesDocumentInput({
      title,
      filename,
      slides: Array.isArray(body?.slides) ? body.slides : [],
      subtitle: typeof body?.subtitle === 'string' ? body.subtitle : undefined,
      author: typeof body?.author === 'string' ? body.author : undefined,
      company: typeof body?.company === 'string' ? body.company : undefined,
      theme: body?.theme && typeof body.theme === 'object' ? body.theme : undefined,
      description: typeof body?.description === 'string' ? body.description : undefined,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!slidesDocumentHasRenderableContent(normalized)) {
      return NextResponse.json({ error: 'At least one slide is required' }, { status: 400 })
    }

    const slidesBytes = await renderSlidesDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)

    const artifact = await prisma.$transaction(tx => createSlidesCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      slidesBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-slides',
      source: {
        name: filename.replace(/\.pptx$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'slides-source',
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
    console.error('[openclaw/slides-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Slide deck generation failed',
    }, { status: 500 })
  }
}