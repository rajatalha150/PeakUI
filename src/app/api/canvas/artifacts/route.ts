import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import type { CanvasArtifactSavePayload } from '@/lib/canvas-artifacts'

const ARTIFACT_LIST_SELECT = {
  id: true,
  name: true,
  mimeType: true,
  kind: true,
  extension: true,
  size: true,
  sessionId: true,
  messageId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  previewKind: true,
  previewSummary: true,
  previewWidth: true,
  previewHeight: true,
  contentHash: true,
  presentationType: true,
  bundleId: true,
  bundleName: true,
  bundleRole: true,
  exportTargets: true,
  sourceArtifactId: true,
  derivedArtifacts: { select: { id: true } },
} as const

function parseArtifactPayload(body: unknown): CanvasArtifactSavePayload | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as Partial<CanvasArtifactSavePayload>
  if (typeof payload.name !== 'string' || typeof payload.content !== 'string' || typeof payload.sessionId !== 'string') {
    return null
  }
  return {
    name: payload.name.trim(),
    content: payload.content,
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : null,
    kind: typeof payload.kind === 'string' ? payload.kind : null,
    extension: typeof payload.extension === 'string' ? payload.extension : null,
    sessionId: payload.sessionId.trim(),
    messageId: typeof payload.messageId === 'string' ? payload.messageId : null,
    bundleId: typeof payload.bundleId === 'string' ? payload.bundleId : null,
    bundleName: typeof payload.bundleName === 'string' ? payload.bundleName : null,
    bundleRole: typeof payload.bundleRole === 'string' ? payload.bundleRole : null,
    sourceArtifactId: typeof payload.sourceArtifactId === 'string' ? payload.sourceArtifactId : null,
  }
}

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: { userId: string; sessionId?: string } = { userId }
    if (sessionId) where.sessionId = sessionId

    const artifacts = await prisma.canvasArtifact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: ARTIFACT_LIST_SELECT,
    })

    return NextResponse.json({ artifacts: artifacts.map(serializeCanvasArtifact) })
  } catch (error) {
    console.error('[canvas/artifacts] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch artifacts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = parseArtifactPayload(await request.json())

    if (!body || !body.name || !body.content || !body.sessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (body.content.length > 10_000_000) {
      return NextResponse.json({ error: 'Artifact content exceeds 10 MB limit' }, { status: 413 })
    }

    const metadata = computeCanvasArtifactMetadata({
      name: body.name,
      content: body.content,
      mimeType: body.mimeType,
      kind: body.kind,
      extension: body.extension,
      sessionId: body.sessionId,
      messageId: body.messageId,
      bundleId: body.bundleId,
      bundleName: body.bundleName,
      bundleRole: body.bundleRole,
    })

    const artifact = await prisma.canvasArtifact.create({
      data: {
        name: body.name,
        content: body.content,
        mimeType: body.mimeType || 'text/plain',
        kind: body.kind || 'file',
        extension: body.extension || body.name.split('.').pop() || null,
        size: Buffer.byteLength(body.content, 'utf8'),
        sessionId: body.sessionId,
        messageId: body.messageId || null,
        userId,
        previewKind: metadata.previewKind,
        previewSummary: metadata.previewSummary,
        previewWidth: metadata.previewWidth,
        previewHeight: metadata.previewHeight,
        contentHash: metadata.contentHash,
        presentationType: metadata.presentationType,
        bundleId: metadata.bundleId,
        bundleName: metadata.bundleName,
        bundleRole: metadata.bundleRole,
        exportTargets: serializeArtifactExportTargets(metadata.exportTargets),
        sourceArtifactId: body.sourceArtifactId || null,
      },
      include: { derivedArtifacts: { select: { id: true } } },
    })

    return NextResponse.json({ artifact: serializeCanvasArtifact(artifact) }, { status: 201 })
  } catch (error) {
    console.error('[canvas/artifacts] POST error:', error)
    return NextResponse.json({ error: 'Failed to create artifact' }, { status: 500 })
  }
}
