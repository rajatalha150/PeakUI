import type {
  ArtifactExportTarget,
  ArtifactPresentationType,
  ArtifactPreviewKind,
} from '@/lib/canvas-artifact-metadata'

export interface CanvasArtifactRecord {
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
  createdAt: string
  updatedAt?: string
  previewKind: ArtifactPreviewKind
  previewSummary: string | null
  previewWidth: number | null
  previewHeight: number | null
  contentHash: string | null
  presentationType: ArtifactPresentationType
  bundleId: string | null
  bundleName: string | null
  bundleRole: string | null
  exportTargets: ArtifactExportTarget[]
  sourceArtifactId: string | null
  sourceArtifact?: CanvasArtifactRelationSummary | null
  derivedArtifacts?: CanvasArtifactRelationSummary[]
  derivedArtifactIds?: string[]
  revisionCount?: number
}

export interface CanvasArtifactRelationSummary {
  id: string
  name: string
  version: number
}

export interface CanvasArtifactRevisionRecord {
  id: string
  artifactId: string
  version: number
  name: string
  content?: string
  mimeType: string
  kind: string
  extension: string | null
  size: number
  previewKind: ArtifactPreviewKind
  previewSummary: string | null
  previewWidth: number | null
  previewHeight: number | null
  contentHash: string | null
  presentationType: ArtifactPresentationType
  bundleId: string | null
  bundleName: string | null
  bundleRole: string | null
  exportTargets: ArtifactExportTarget[]
  sourceArtifactId: string | null
  messageId: string | null
  createdAt: string
}

export type CanvasArtifactSavePayload = {
  name: string
  content: string
  mimeType?: string | null
  kind?: string | null
  extension?: string | null
  sessionId: string
  messageId?: string | null
  bundleId?: string | null
  bundleName?: string | null
  bundleRole?: string | null
  sourceArtifactId?: string | null
}

export function isImageArtifact(artifact: Pick<CanvasArtifactRecord, 'mimeType'>): boolean {
  return artifact.mimeType.startsWith('image/')
}

export function isMarkdownArtifact(artifact: Pick<CanvasArtifactRecord, 'mimeType' | 'extension' | 'previewKind'>): boolean {
  return artifact.previewKind === 'markdown'
    || artifact.mimeType === 'text/markdown'
    || artifact.extension === 'md'
    || artifact.extension === 'markdown'
}

export function isCodeArtifact(artifact: Pick<CanvasArtifactRecord, 'previewKind'>): boolean {
  return artifact.previewKind === 'code'
}

export function isTableArtifact(artifact: Pick<CanvasArtifactRecord, 'previewKind' | 'presentationType'>): boolean {
  return artifact.previewKind === 'table' || artifact.presentationType === 'table'
}

export function isChartArtifact(artifact: Pick<CanvasArtifactRecord, 'previewKind' | 'presentationType'>): boolean {
  return artifact.previewKind === 'chart' || artifact.presentationType === 'chart'
}

export function inferArtifactKind(name: string, mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'diagram'
  if (mimeType === 'text/markdown') return 'markdown'
  const ext = name.split('.').pop()?.toLowerCase()
  if (['json', 'csv', 'tsv', 'xml', 'yaml', 'yml'].includes(ext || '')) return 'data'
  return 'file'
}
