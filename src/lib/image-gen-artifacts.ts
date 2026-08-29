import type { Prisma } from '@prisma/client'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'

/**
 * Persist a generated image as a Canvas artifact so it renders inline in chat
 * and is downloadable through the standard `/api/canvas/artifacts/<id>/download`
 * route. Mirrors `createMermaidCanvasArtifact` / `createPdfCanvasArtifact`.
 */
export async function createImageCanvasArtifact(input: {
  tx: Prisma.TransactionClient
  userId: string
  sessionId: string
  messageId?: string | null
  name: string
  imageBytes: Buffer
  mimeType: string
  bundleName?: string | null
  bundleRole?: string | null
}) {
  const content = input.imageBytes.toString('base64')
  const extension = input.mimeType === 'image/png' ? 'png'
    : input.mimeType === 'image/jpeg' ? 'jpg'
    : input.mimeType === 'image/webp' ? 'webp'
    : input.name.toLowerCase().endsWith('.png') ? 'png'
    : 'png'
  const bundleId = input.messageId ?? null

  const metadata = computeCanvasArtifactMetadata({
    name: input.name,
    content,
    mimeType: input.mimeType,
    kind: 'image',
    extension,
    sessionId: input.sessionId,
    messageId: input.messageId ?? null,
    bundleId,
    bundleName: input.bundleName ?? 'Generated Image',
    bundleRole: input.bundleRole ?? 'generated-image',
  })

  const created = await input.tx.canvasArtifact.create({
    data: {
      name: input.name,
      content,
      mimeType: input.mimeType,
      kind: 'image',
      extension,
      size: input.imageBytes.byteLength,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      userId: input.userId,
      previewKind: metadata.previewKind,
      previewSummary: metadata.previewSummary || 'Generated image',
      previewWidth: metadata.previewWidth,
      previewHeight: metadata.previewHeight,
      contentHash: metadata.contentHash,
      presentationType: metadata.presentationType,
      bundleId: metadata.bundleId,
      bundleName: metadata.bundleName,
      bundleRole: metadata.bundleRole,
      exportTargets: serializeArtifactExportTargets(metadata.exportTargets),
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
