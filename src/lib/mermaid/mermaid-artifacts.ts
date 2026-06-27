import type { Prisma } from '@prisma/client'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'

export async function createMermaidCanvasArtifact(input: {
  tx: Prisma.TransactionClient
  userId: string
  sessionId: string
  messageId?: string | null
  name: string
  diagramBytes: Buffer
  mimeType: string
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
  const content = input.diagramBytes.toString('base64')
  let sourceArtifactId = input.sourceArtifactId ?? null
  const bundleId = input.messageId ?? null

  if (input.source && !sourceArtifactId) {
    const sourceMetadata = computeCanvasArtifactMetadata({
      name: input.source.name,
      content: input.source.content,
      mimeType: input.source.mimeType ?? 'text/plain',
      kind: input.source.kind ?? 'diagram-mermaid',
      extension: input.source.extension ?? 'mmd',
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      bundleId,
      bundleName: input.bundleName ?? 'Generated Diagram',
      bundleRole: input.source.bundleRole ?? 'mermaid-source',
    })

    const source = await input.tx.canvasArtifact.create({
      data: {
        name: input.source.name,
        content: input.source.content,
        mimeType: input.source.mimeType ?? 'text/plain',
        kind: input.source.kind ?? 'diagram-mermaid',
        extension: input.source.extension ?? 'mmd',
        size: Buffer.byteLength(input.source.content, 'utf8'),
        sessionId: input.sessionId,
        messageId: input.messageId ?? null,
        userId: input.userId,
        previewKind: sourceMetadata.previewKind,
        previewSummary: sourceMetadata.previewSummary || 'Mermaid source',
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

  // Derive extension from the actual mime type so PNG output isn't labelled as
  // an .mmd text file. The old filename-based check silently mis-stored PNG
  // artifacts under extension 'mmd' (which broke download/preview content-type
  // matching in the canvas UI).
  const extension = input.mimeType === 'image/png' ? 'png'
    : input.mimeType === 'image/svg+xml' ? 'svg'
    : input.name.toLowerCase().endsWith('.png') ? 'png'
    : 'svg'
  const mimeType = input.mimeType
  const metadata = computeCanvasArtifactMetadata({
    name: input.name,
    content,
    mimeType,
    kind: 'diagram-mermaid',
    extension,
    sessionId: input.sessionId,
    messageId: input.messageId ?? null,
    bundleId,
    bundleName: input.bundleName ?? 'Generated Diagram',
    bundleRole: input.bundleRole ?? 'generated-mermaid',
  })

  const created = await input.tx.canvasArtifact.create({
    data: {
      name: input.name,
      content,
      mimeType,
      kind: 'diagram-mermaid',
      extension,
      size: input.diagramBytes.byteLength,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      userId: input.userId,
      previewKind: metadata.previewKind,
      previewSummary: metadata.previewSummary || 'Generated Mermaid diagram',
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
