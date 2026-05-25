import type { CanvasArtifactRecord, CanvasArtifactRevisionRecord } from '@/lib/canvas-artifacts'
import { parseArtifactExportTargets } from '@/lib/canvas-artifact-metadata'

type ArtifactRelationRow = {
  id: string
  name: string
  version: number
}

type ArtifactRow = {
  id: string
  name: string
  content?: string
  mimeType: string
  kind: string
  extension: string | null
  size: number
  sessionId: string
  messageId: string | null
  version: number
  createdAt: Date
  updatedAt: Date
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
  sourceArtifact?: ArtifactRelationRow | null
  derivedArtifacts?: ArtifactRelationRow[]
  _count?: { revisions?: number }
}

type ArtifactRevisionRow = {
  id: string
  artifactId: string
  version: number
  name: string
  content?: string
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
  createdAt: Date
}

export function serializeCanvasArtifact(row: ArtifactRow): CanvasArtifactRecord {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    mimeType: row.mimeType,
    kind: row.kind,
    extension: row.extension,
    size: row.size,
    sessionId: row.sessionId,
    messageId: row.messageId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    previewKind: row.previewKind as CanvasArtifactRecord['previewKind'],
    previewSummary: row.previewSummary,
    previewWidth: row.previewWidth,
    previewHeight: row.previewHeight,
    contentHash: row.contentHash,
    presentationType: row.presentationType as CanvasArtifactRecord['presentationType'],
    bundleId: row.bundleId,
    bundleName: row.bundleName,
    bundleRole: row.bundleRole,
    exportTargets: parseArtifactExportTargets(row.exportTargets),
    sourceArtifactId: row.sourceArtifactId,
    sourceArtifact: row.sourceArtifact ?? null,
    derivedArtifacts: row.derivedArtifacts ?? [],
    derivedArtifactIds: row.derivedArtifacts?.map(artifact => artifact.id) ?? [],
    revisionCount: row._count?.revisions ?? undefined,
  }
}

export function serializeCanvasArtifactRevision(row: ArtifactRevisionRow): CanvasArtifactRevisionRecord {
  return {
    id: row.id,
    artifactId: row.artifactId,
    version: row.version,
    name: row.name,
    content: row.content,
    mimeType: row.mimeType,
    kind: row.kind,
    extension: row.extension,
    size: row.size,
    previewKind: row.previewKind as CanvasArtifactRevisionRecord['previewKind'],
    previewSummary: row.previewSummary,
    previewWidth: row.previewWidth,
    previewHeight: row.previewHeight,
    contentHash: row.contentHash,
    presentationType: row.presentationType as CanvasArtifactRevisionRecord['presentationType'],
    bundleId: row.bundleId,
    bundleName: row.bundleName,
    bundleRole: row.bundleRole,
    exportTargets: parseArtifactExportTargets(row.exportTargets),
    sourceArtifactId: row.sourceArtifactId,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
  }
}
