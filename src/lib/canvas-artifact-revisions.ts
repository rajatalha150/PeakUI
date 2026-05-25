import type { Prisma } from '@prisma/client'

export type CanvasArtifactRevisionSnapshot = {
  id: string
  version: number
  name: string
  content: string
  mimeType: string
  kind: string
  extension: string | null
  size: number
  previewKind: string
  previewSummary: string | null
  previewWidth: number | null
  previewHeight: number | null
  contentHash: string | null
  presentationType: string
  bundleId: string | null
  bundleName: string | null
  bundleRole: string | null
  exportTargets: string
  sourceArtifactId: string | null
  messageId: string | null
}

export async function upsertCanvasArtifactRevision(
  tx: Prisma.TransactionClient,
  artifact: CanvasArtifactRevisionSnapshot,
) {
  await tx.canvasArtifactRevision.upsert({
    where: {
      artifactId_version: {
        artifactId: artifact.id,
        version: artifact.version,
      },
    },
    update: {
      name: artifact.name,
      content: artifact.content,
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
    },
    create: {
      artifactId: artifact.id,
      version: artifact.version,
      name: artifact.name,
      content: artifact.content,
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
    },
  })
}
