import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'

const ARTIFACT_DETAIL_INCLUDE = {
  derivedArtifacts: { select: { id: true } },
} as const

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      include: ARTIFACT_DETAIL_INCLUDE,
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ artifact: serializeCanvasArtifact(artifact) })
  } catch (error) {
    console.error('[canvas/artifacts/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch artifact' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined
    const content = typeof body?.content === 'string' ? body.content : undefined
    const sourceArtifactId = typeof body?.sourceArtifactId === 'string' ? body.sourceArtifactId : undefined

    const existing = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      include: ARTIFACT_DETAIL_INCLUDE,
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const nextName = name ?? existing.name
    const nextContent = content ?? existing.content
    const metadata = computeCanvasArtifactMetadata({
      name: nextName,
      content: nextContent,
      mimeType: existing.mimeType,
      kind: existing.kind,
      extension: existing.extension,
      sessionId: existing.sessionId,
      messageId: existing.messageId,
      bundleId: existing.bundleId,
      bundleName: existing.bundleName,
      bundleRole: existing.bundleRole,
    })

    const artifact = await prisma.canvasArtifact.update({
      where: { id },
      data: {
        name: nextName,
        content: nextContent,
        size: content ? Buffer.byteLength(content, 'utf8') : existing.size,
        version: existing.version + 1,
        updatedAt: new Date(),
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
        sourceArtifactId: sourceArtifactId === undefined ? existing.sourceArtifactId : sourceArtifactId,
      },
      include: ARTIFACT_DETAIL_INCLUDE,
    })

    return NextResponse.json({ artifact: serializeCanvasArtifact(artifact) })
  } catch (error) {
    console.error('[canvas/artifacts/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update artifact' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.canvasArtifact.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[canvas/artifacts/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete artifact' }, { status: 500 })
  }
}
