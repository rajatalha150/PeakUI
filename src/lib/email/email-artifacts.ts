import type { Prisma } from '@prisma/client'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'

export async function createEmailCanvasArtifact(input: {
  tx: Prisma.TransactionClient
  userId: string
  sessionId: string
  messageId?: string | null
  name: string
  emlBytes: Buffer
  bundleName?: string | null
  bundleRole?: string | null
  sourceArtifactId?: string | null
  source?: {
    name: string
    content: string
    mimeType?: string
    kind?: string
    extension?: string
    bundleRole?: string
  }
}) {
  const content = input.emlBytes.toString('base64')
  let sourceArtifactId = input.sourceArtifactId ?? null
  const bundleId = input.messageId ?? null

  if (input.source && !sourceArtifactId) {
    const sourceMetadata = computeCanvasArtifactMetadata({
      name: input.source.name,
      content: input.source.content,
      mimeType: input.source.mimeType ?? 'application/json',
      kind: input.source.kind ?? 'data',
      extension: input.source.extension ?? 'json',
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      bundleId,
      bundleName: input.bundleName ?? 'Generated Email',
      bundleRole: input.source.bundleRole ?? 'email-source',
    })

    const source = await input.tx.canvasArtifact.create({
      data: {
        name: input.source.name,
        content: input.source.content,
        mimeType: input.source.mimeType ?? 'application/json',
        kind: input.source.kind ?? 'data',
        extension: input.source.extension ?? 'json',
        size: Buffer.byteLength(input.source.content, 'utf8'),
        sessionId: input.sessionId,
        messageId: input.messageId ?? null,
        userId: input.userId,
        previewKind: sourceMetadata.previewKind,
        previewSummary: sourceMetadata.previewSummary || 'Email source document',
        previewWidth: sourceMetadata.previewWidth,
        previewHeight: sourceMetadata.previewHeight,
        contentHash: sourceMetadata.contentHash,
        presentationType: sourceMetadata.presentationType,
        bundleId: sourceMetadata.bundleId,
        bundleName: sourceMetadata.bundleName,
        bundleRole: sourceMetadata.bundleRole,
        exportTargets: serializeArtifactExportTargets(sourceMetadata.exportTargets),
      },
      include: {
        sourceArtifact: { select: { id: true, name: true, version: true } },
        derivedArtifacts: { select: { id: true, name: true, version: true } },
        _count: { select: { revisions: true } },
      },
    })
    await upsertCanvasArtifactRevision(input.tx, source)
    sourceArtifactId = source.id
  }

  const metadata = computeCanvasArtifactMetadata({
    name: input.name,
    content,
    mimeType: 'message/rfc822',
    kind: 'data',
    extension: 'eml',
    sessionId: input.sessionId,
    messageId: input.messageId ?? null,
    bundleId,
    bundleName: input.bundleName ?? 'Generated Email',
    bundleRole: input.bundleRole ?? 'generated-email',
  })

  const created = await input.tx.canvasArtifact.create({
    data: {
      name: input.name,
      content,
      mimeType: 'message/rfc822',
      kind: 'data',
      extension: 'eml',
      size: input.emlBytes.byteLength,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      userId: input.userId,
      previewKind: metadata.previewKind,
      previewSummary: metadata.previewSummary || 'Generated email draft',
      previewWidth: metadata.previewWidth,
      previewHeight: metadata.previewHeight,
      contentHash: metadata.contentHash,
      presentationType: metadata.presentationType,
      bundleId: metadata.bundleId,
      bundleName: metadata.bundleName,
      bundleRole: metadata.bundleRole,
      exportTargets: serializeArtifactExportTargets(metadata.exportTargets),
      sourceArtifactId,
    },
    include: {
      sourceArtifact: { select: { id: true, name: true, version: true } },
      derivedArtifacts: { select: { id: true, name: true, version: true } },
      _count: { select: { revisions: true } },
    },
  })

  await upsertCanvasArtifactRevision(input.tx, created)
  return serializeCanvasArtifact(created)
}
