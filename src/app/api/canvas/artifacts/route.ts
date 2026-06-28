import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import {
  CANVAS_ARTIFACT_CONTENT_LIMIT,
  normalizeCanvasArtifactListParams,
} from '@/lib/canvas-api'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { decodeArtifactContent } from '@/lib/canvas-download'
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
  sourceArtifact: { select: { id: true, name: true, version: true } },
  derivedArtifacts: { select: { id: true, name: true, version: true } },
  _count: { select: { revisions: true } },
} as const

// For binary mime types the stored `content` is base64, so the byte length
// of the string overstates the actual file size by ~37%. Use the decoded
// length so quota checks, the UI's "Size: X" line, and revision diffs all
// reflect the real artifact size.
function artifactByteLength(content: string, mimeType: string | null): number {
  const resolvedMime = mimeType || 'text/plain'
  return decodeArtifactContent(content, resolvedMime).byteLength
}

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
    const params = normalizeCanvasArtifactListParams(new URL(request.url).searchParams)

    const where: Prisma.CanvasArtifactWhereInput = { userId }
    if (params.sessionId) where.sessionId = params.sessionId
    if (params.presentationType) where.presentationType = params.presentationType
    if (params.bundleId) where.bundleId = params.bundleId
    if (params.query) {
      where.OR = [
        { name: { contains: params.query, mode: 'insensitive' } },
        { previewSummary: { contains: params.query, mode: 'insensitive' } },
        { bundleName: { contains: params.query, mode: 'insensitive' } },
        { bundleRole: { contains: params.query, mode: 'insensitive' } },
        { presentationType: { contains: params.query, mode: 'insensitive' } },
      ]
    }

    const cursor = params.cursor
      ? await prisma.canvasArtifact.findFirst({
        where: { id: params.cursor, userId },
        select: { id: true },
      })
      : null

    const [artifacts, total] = await Promise.all([
      prisma.canvasArtifact.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: params.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
        select: ARTIFACT_LIST_SELECT,
      }),
      prisma.canvasArtifact.count({ where }),
    ])

    const visibleArtifacts = artifacts.slice(0, params.limit)
    const nextCursor = artifacts.length > params.limit
      ? visibleArtifacts[visibleArtifacts.length - 1]?.id ?? null
      : null

    return NextResponse.json({
      artifacts: visibleArtifacts.map(serializeCanvasArtifact),
      pageInfo: {
        hasMore: Boolean(nextCursor),
        nextCursor,
        limit: params.limit,
        total,
      },
    })
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

    if (!body || !body.name || !body.sessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (body.content.length > CANVAS_ARTIFACT_CONTENT_LIMIT) {
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

    const artifact = await prisma.$transaction(async (tx) => {
      const created = await tx.canvasArtifact.create({
        data: {
          name: body.name,
          content: body.content,
          mimeType: body.mimeType || 'text/plain',
          kind: body.kind || 'file',
          extension: body.extension || body.name.split('.').pop() || null,
          size: artifactByteLength(body.content, body.mimeType ?? 'text/plain'),
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
        include: {
          sourceArtifact: { select: { id: true, name: true, version: true } },
          derivedArtifacts: { select: { id: true, name: true, version: true } },
          _count: { select: { revisions: true } },
        },
      })

      await upsertCanvasArtifactRevision(tx, created)

      return tx.canvasArtifact.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          sourceArtifact: { select: { id: true, name: true, version: true } },
          derivedArtifacts: { select: { id: true, name: true, version: true } },
          _count: { select: { revisions: true } },
        },
      })
    })

    return NextResponse.json({ artifact: serializeCanvasArtifact(artifact) }, { status: 201 })
  } catch (error) {
    console.error('[canvas/artifacts] POST error:', error)
    return NextResponse.json({ error: 'Failed to create artifact' }, { status: 500 })
  }
}
