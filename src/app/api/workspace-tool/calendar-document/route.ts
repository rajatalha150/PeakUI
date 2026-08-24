import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import { createCalendarCanvasArtifact } from '@/lib/calendar/calendar-artifacts'
import {
  normalizeCalendarDocumentInput,
  calendarDocumentHasRenderableContent,
} from '@/lib/calendar/calendar-schema'
import { renderCalendarDocument } from '@/lib/calendar/calendar-renderer'

export const runtime = 'nodejs'
export const maxDuration = 60

function sanitizeFilename(value: string): string {
  const clean = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'generated-event'
  return clean.toLowerCase().endsWith('.ics') ? clean : `${clean}.ics`
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'canvas.use'], {
    forbiddenMessage: 'Calendar event generation requires WorkSpaces and Canvas permissions.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Generated Calendar'
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : ''
    const messageId = typeof body?.messageId === 'string' && body.messageId.trim() ? body.messageId.trim() : null
    const filename = sanitizeFilename(
      typeof body?.filename === 'string' && body.filename.trim() ? body.filename.trim() : title,
    )

    const normalized = normalizeCalendarDocumentInput({
      title,
      filename,
      events: Array.isArray(body?.events) ? body.events : [],
      description: typeof body?.description === 'string' ? body.description : undefined,
      calendarName: typeof body?.calendarName === 'string' ? body.calendarName : undefined,
    })

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!calendarDocumentHasRenderableContent(normalized)) {
      return NextResponse.json({ error: 'At least one event is required' }, { status: 400 })
    }

    const calendarBytes = await renderCalendarDocument(normalized)
    const sourceContent = JSON.stringify(normalized, null, 2)

    const artifact = await prisma.$transaction(tx => createCalendarCanvasArtifact({
      tx,
      userId: access.userId,
      sessionId,
      messageId,
      name: filename,
      calendarBytes,
      bundleName: normalized.title,
      bundleRole: 'generated-calendar',
      source: {
        name: filename.replace(/\.ics$/i, '.source.json'),
        content: sourceContent,
        mimeType: 'application/json',
        kind: 'data',
        extension: 'json',
        bundleRole: 'calendar-source',
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
    console.error('[workspace-tool/calendar-document] POST error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Calendar generation failed',
    }, { status: 500 })
  }
}