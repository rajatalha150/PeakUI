import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import { CANVAS_ARTIFACT_CONTENT_LIMIT } from '@/lib/canvas-api'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'
import {
  serializeCanvasArtifact,
  serializeCanvasArtifactRevision,
} from '@/lib/canvas-artifact-serialization'

const ARTIFACT_INCLUDE = {
  sourceArtifact: { select: { id: true, name: true, version: true } },
  derivedArtifacts: { select: { id: true, name: true, version: true } },
  _count: { select: { revisions: true } },
} as const

function normalizeRevisionLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return 50
  return Math.min(Math.max(parsed, 1), 100)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const searchParams = new URL(request.url).searchParams
    const includeContent = searchParams.get('includeContent') === '1'
    const limit = normalizeRevisionLimit(searchParams.get('limit'))

    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      include: ARTIFACT_INCLUDE,
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const revisions = await prisma.canvasArtifactRevision.findMany({
      where: { artifactId: id },
      orderBy: { version: 'desc' },
      take: limit,
      select: {
        id: true,
        artifactId: true,
        version: true,
        name: true,
        content: includeContent,
        mimeType: true,
        kind: true,
        extension: true,
        size: true,
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
        messageId: true,
        createdAt: true,
      },
    })

    const serializedRevisions = revisions.length > 0
      ? revisions.map(serializeCanvasArtifactRevision)
      : [serializeCanvasArtifactRevision({
        id: artifact.id,
        artifactId: artifact.id,
        version: artifact.version,
        name: artifact.name,
        content: includeContent ? artifact.content : undefined,
        mimeType: artifact.mimeType,
        kind: artifact.kind,
        extension: artifact.extension,
        size: artifact.size,
        previewKind: artifact.previewKind,
        previewSummary: artifact.previewSummary,
        previewWidth: artifact.previewWidth,
        previewHeight: artifact.previewHeight,
        contentHash: artifact.contentHash,
        presentationType: artifact.presentationType,
        bundleId: artifact.bundleId,
        bundleName: artifact.bundleName,
        bundleRole: artifact.bundleRole,
        exportTargets: artifact.exportTargets,
        sourceArtifactId: artifact.sourceArtifactId,
        messageId: artifact.messageId,
        createdAt: artifact.updatedAt,
      })]

    return NextResponse.json({
      artifact: serializeCanvasArtifact(artifact),
      revisions: serializedRevisions,
    })
  } catch (error) {
    console.error('[canvas/artifacts/[id]/revisions] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch artifact revisions' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const version = Number.parseInt(String(body?.version ?? ''), 10)

    if (!Number.isFinite(version) || version < 1) {
      return NextResponse.json({ error: 'Valid revision version is required' }, { status: 400 })
    }

    const existing = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      include: ARTIFACT_INCLUDE,
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const revision = await prisma.canvasArtifactRevision.findFirst({
      where: { artifactId: id, version },
    })

    if (!revision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
    }

    if (revision.content.length > CANVAS_ARTIFACT_CONTENT_LIMIT) {
      return NextResponse.json({ error: 'Artifact content exceeds 10 MB limit' }, { status: 413 })
    }

    const nextVersion = existing.version + 1
    const metadata = computeCanvasArtifactMetadata({
      name: revision.name,
      content: revision.content,
      mimeType: revision.mimeType,
      kind: revision.kind,
      extension: revision.extension,
      sessionId: existing.sessionId,
      messageId: revision.messageId,
      bundleId: revision.bundleId,
      bundleName: revision.bundleName,
      bundleRole: revision.bundleRole,
    })

    const artifact = await prisma.$transaction(async (tx) => {
      await upsertCanvasArtifactRevision(tx, existing)

      const restored = await tx.canvasArtifact.update({
        where: { id },
        data: {
          name: revision.name,
          content: revision.content,
          mimeType: revision.mimeType,
          kind: revision.kind,
          extension: revision.extension,
          size: revision.size,
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
          sourceArtifactId: revision.sourceArtifactId,
          messageId: revision.messageId,
        },
        include: ARTIFACT_INCLUDE,
      })

      await upsertCanvasArtifactRevision(tx, restored)

      return tx.canvasArtifact.findUniqueOrThrow({
        where: { id },
        include: ARTIFACT_INCLUDE,
      })
    })

    return NextResponse.json({ artifact: serializeCanvasArtifact(artifact) })
  } catch (error) {
    console.error('[canvas/artifacts/[id]/revisions] POST error:', error)
    return NextResponse.json({ error: 'Failed to restore artifact revision' }, { status: 500 })
  }
}
