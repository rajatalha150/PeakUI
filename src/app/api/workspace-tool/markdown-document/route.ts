import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createMarkdownCanvasArtifact } from '@/lib/markdown/markdown-artifacts'
import {
  normalizeMarkdownDocumentInput,
  type MarkdownDocumentInput,
} from '@/lib/markdown/markdown-schema'
import { renderMarkdownDocument } from '@/lib/markdown/markdown-renderer'
import { assertNonEmptyArtifactBytes, isPlaceholderDocumentText } from '@/lib/document-generation-guard'
import { deliverDocumentToWorkspace } from '@/lib/workspace-document-delivery'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-markdown'
  return clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'canvas.use'], {
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
    if (!normalized.content.trim() || isPlaceholderDocumentText(normalized.content)) {
      return NextResponse.json({
        code: 'ARTIFACT_CONTENT_REQUIRED',
        error: 'Markdown content was a recovery placeholder. Provide actual Markdown content.',
        retryable: true,
      }, { status: 422 })
    }
    const markdownBytes = renderMarkdownDocument(normalized)
    assertNonEmptyArtifactBytes(markdownBytes, 'Markdown', 3)
    const sourceContent = JSON.stringify(normalized, null, 2)
    
    // Deliver the file into the selected workspace so it appears in the Files
    // panel — the Canvas artifact alone left the file tree empty. Best-effort.
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : null
    const delivery = await deliverDocumentToWorkspace({
      userId: access.userId,
      sessionId,
      workspaceId,
      filename: filename.toLowerCase().endsWith('.md') ? filename : `${filename}.md`,
      bytes: markdownBytes,
    })

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
      ...(delivery.ok && delivery.hostPath
        ? { workspaceFile: { path: delivery.hostPath, note: 'The file was also saved into the selected workspace and is visible in the Files panel.' } }
        : { workspaceFileError: delivery.error || 'The file could not be saved into the workspace; use the download link.' }),
    })
  } catch (error) {
    console.error('[workspace-tool/markdown-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Markdown document generation failed',
    }, { status: 500 })
  }
}
