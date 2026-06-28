import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import { CANVAS_ARTIFACT_CONTENT_LIMIT } from '@/lib/canvas-api'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { decodeArtifactContent } from '@/lib/canvas-download'

const ARTIFACT_DETAIL_INCLUDE = {
  sourceArtifact: { select: { id: true, name: true, version: true } },
  derivedArtifacts: { select: { id: true, name: true, version: true } },
  _count: { select: { revisions: true } },
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
    const sourceArtifactId = typeof body?.sourceArtifactId === 'string'
      ? body.sourceArtifactId
      : body?.sourceArtifactId === null
        ? null
        : undefined

    if (name !== undefined && !name) {
      return NextResponse.json({ error: 'Artifact name is required' }, { status: 400 })
    }

    if (content !== undefined && content.length > CANVAS_ARTIFACT_CONTENT_LIMIT) {
      return NextResponse.json({ error: 'Artifact content exceeds 10 MB limit' }, { status: 413 })
    }

    const existing = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      include: ARTIFACT_DETAIL_INCLUDE,
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (sourceArtifactId && sourceArtifactId === id) {
      return NextResponse.json({ error: 'An artifact cannot derive from itself' }, { status: 400 })
    }

    if (sourceArtifactId) {
      const sourceExists = await prisma.canvasArtifact.findFirst({
        where: { id: sourceArtifactId, userId },
        select: { id: true },
      })
      if (!sourceExists) {
        return NextResponse.json({ error: 'Source artifact not found' }, { status: 404 })
      }
    }

    const nextName = name ?? existing.name
    const nextContent = content ?? existing.content
    const nextVersion = existing.version + 1
    // For binary mime types the stored `content` is base64; use the decoded
    // byte length so the stored size matches the real artifact size.
    const nextSize = content !== undefined
      ? decodeArtifactContent(nextContent, existing.mimeType).byteLength
      : existing.size
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

    const artifact = await prisma.$transaction(async (tx) => {
      await upsertCanvasArtifactRevision(tx, existing)

      const updated = await tx.canvasArtifact.update({
        where: { id },
        data: {
          name: nextName,
          content: nextContent,
          size: nextSize,
          version: nextVersion,
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

      await upsertCanvasArtifactRevision(tx, updated)

      return tx.canvasArtifact.findUniqueOrThrow({
        where: { id },
        include: ARTIFACT_DETAIL_INCLUDE,
      })
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
