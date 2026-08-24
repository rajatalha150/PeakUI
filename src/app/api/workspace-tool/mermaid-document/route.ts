import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createMermaidCanvasArtifact } from '@/lib/mermaid/mermaid-artifacts'
import {
  normalizeMermaidDocumentInput,
  mermaidDocumentHasRenderableContent,
} from '@/lib/mermaid/mermaid-schema'
import { renderMermaidDocument } from '@/lib/mermaid/mermaid-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string, format: 'svg' | 'png'): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-diagram'
  const ext = `.${format}`
  return clean.toLowerCase().endsWith(ext) ? clean : `${clean}${ext}`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'canvas.use'], {
    forbiddenMessage: 'Mermaid diagram generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Diagram'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null

    const normalized = normalizeMermaidDocumentInput({
      title,
      filename: typeof body?.filename === 'string' ? body.filename : undefined,
      description: typeof body?.description === 'string' ? body.description : undefined,
      diagram: typeof body?.diagram === 'string' ? body.diagram : '',
      format: body?.format === 'png' ? 'png' : 'svg',
      theme: body?.theme === 'dark' || body?.theme === 'forest' || body?.theme === 'neutral' ? body.theme : 'default',
      backgroundColor: typeof body?.backgroundColor === 'string' ? body.backgroundColor : undefined,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!mermaidDocumentHasRenderableContent(normalized)) {
      return NextResponse.json({ error: 'A Mermaid diagram source is required' }, { status: 400 })
    }

    const filename = sanitizeFilename(
      typeof normalized.filename === 'string' && normalized.filename.trim() ? normalized.filename : title,
      normalized.format,
    )
    const mimeType = normalized.format === 'png' ? 'image/png' : 'image/svg+xml'

    const diagramBytes = await renderMermaidDocument(normalized)

    const artifact = await prisma.$transaction(tx => createMermaidCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      diagramBytes,
      mimeType,
      bundleName: normalized.title,
      bundleRole: 'generated-mermaid',
      source: {
        name: filename.replace(/\.(svg|png)$/i, '.mmd'),
        content: normalized.diagram,
        mimeType: 'text/plain',
        kind: 'diagram-mermaid',
        extension: 'mmd',
        bundleRole: 'mermaid-source',
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
    console.error('[workspace-tool/mermaid-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Mermaid generation failed',
    }, { status: 500 })
  }
}