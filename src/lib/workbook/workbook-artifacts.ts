import type { Prisma } from '@prisma/client'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function createWorkbookCanvasArtifact(input: {
  tx: Prisma.TransactionClient
  userId: string
  sessionId: string
  messageId?: string | null
  name: string
  workbookBytes: Buffer
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
  const bundleId = input.messageId ?? null
  let sourceArtifactId = input.sourceArtifactId ?? null

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
      bundleName: input.bundleName ?? 'Generated Workbook',
      bundleRole: input.source.bundleRole ?? 'workbook-source',
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
        previewSummary: sourceMetadata.previewSummary || 'Workbook source document',
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

  const content = input.workbookBytes.toString('base64')
  const metadata = computeCanvasArtifactMetadata({
    name: input.name,
    content,
    mimeType: XLSX_MIME_TYPE,
    kind: 'workbook',
    extension: 'xlsx',
    sessionId: input.sessionId,
    messageId: input.messageId ?? null,
    bundleId,
    bundleName: input.bundleName ?? 'Generated Workbook',
    bundleRole: input.bundleRole ?? 'generated-workbook',
  })

  const created = await input.tx.canvasArtifact.create({
    data: {
      name: input.name,
      content,
      mimeType: XLSX_MIME_TYPE,
      kind: 'workbook',
      extension: 'xlsx',
      size: input.workbookBytes.byteLength,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      userId: input.userId,
      previewKind: metadata.previewKind,
      previewSummary: metadata.previewSummary || 'Generated Excel workbook',
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
