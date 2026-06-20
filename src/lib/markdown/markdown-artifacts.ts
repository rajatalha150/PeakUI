import type { Prisma } from '@prisma/client'
import {
  computeCanvasArtifactMetadata,
  serializeArtifactExportTargets,
} from '@/lib/canvas-artifact-metadata'
import { serializeCanvasArtifact } from '@/lib/canvas-artifact-serialization'
import { upsertCanvasArtifactRevision } from '@/lib/canvas-artifact-revisions'

export const MARKDOWN_MIME_TYPE = 'text/markdown'

export async function createMarkdownCanvasArtifact(input: {
  tx: Prisma.TransactionClient
  userId: string
  sessionId: string
  messageId?: string | null
  name: string
  markdownBytes: Buffer
  bundleName?: string | null
  bundleRole?: string | null
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
  let sourceArtifactId: string | null = null

  if (input.source) {
    const sourceMetadata = computeCanvasArtifactMetadata({
      name: input.source.name,
      content: input.source.content,
      mimeType: input.source.mimeType ?? 'application/json',
      kind: input.source.kind ?? 'data',
      extension: input.source.extension ?? 'json',
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      bundleId,
      bundleName: input.bundleName ?? 'Generated Markdown Document',
      bundleRole: input.source.bundleRole ?? 'markdown-source',
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
        previewSummary: sourceMetadata.previewSummary || 'Markdown source',
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

  // Store markdown as plain text so preview and editing work directly.
  const content = input.markdownBytes.toString('utf8')
  const metadata = computeCanvasArtifactMetadata({
    name: input.name,
    content,
    mimeType: MARKDOWN_MIME_TYPE,
    kind: 'markdown',
    extension: 'md',
    sessionId: input.sessionId,
    messageId: input.messageId ?? null,
    bundleId,
    bundleName: input.bundleName ?? 'Generated Markdown Document',
    bundleRole: input.bundleRole ?? 'generated-markdown',
  })

  const created = await input.tx.canvasArtifact.create({
    data: {
      name: input.name,
      content,
      mimeType: MARKDOWN_MIME_TYPE,
      kind: 'markdown',
      extension: 'md',
      size: input.markdownBytes.byteLength,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      userId: input.userId,
      previewKind: metadata.previewKind,
      previewSummary: metadata.previewSummary || 'Generated Markdown document',
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
