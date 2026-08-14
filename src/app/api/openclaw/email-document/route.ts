import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createEmailCanvasArtifact } from '@/lib/email/email-artifacts'
import { normalizeEmailDocumentInput, ensureEmailRenderableContent, type EmailDocumentInput } from '@/lib/email/email-schema'
import { renderEmailDocument } from '@/lib/email/email-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-email'
  return clean.toLowerCase().endsWith('.eml') ? clean : `${clean}.eml`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use', 'canvas.use'], {
    forbiddenMessage: 'Email generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Email'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title)
    const normalized = normalizeEmailDocumentInput({
      ...(body as Partial<EmailDocumentInput>),
      title,
      filename,
      subject: typeof body?.subject === 'string' && body.subject.trim() ? body.subject.trim() : '',
      body: typeof body?.body === 'string' ? body.body : '',
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    ensureEmailRenderableContent(normalized)

    const emlBytes = renderEmailDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)

    const artifact = await prisma.$transaction(tx => createEmailCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      emlBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-email',
      source: {
        name: filename.replace(/\.eml$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'email-source',
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
    console.error('[openclaw/email-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Email generation failed',
    }, { status: 500 })
  }
}
