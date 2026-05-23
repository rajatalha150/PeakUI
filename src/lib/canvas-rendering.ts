import type { ArtifactExportTarget } from '@/lib/canvas-artifact-metadata'
import type { CanvasArtifactRecord } from '@/lib/canvas-artifacts'

export const COLLAPSED_PREVIEW_CHARS = 1600
export const COLLAPSED_PREVIEW_LINES = 28
export const CONTENT_PREVIEW_THRESHOLD = 24_000
export const IMAGE_PREVIEW_MAX_WIDTH = 720
export const IMAGE_PREVIEW_MAX_HEIGHT = 420

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function buildCollapsedPreview(content: string, maxChars = COLLAPSED_PREVIEW_CHARS, maxLines = COLLAPSED_PREVIEW_LINES): string {
  const normalized = content.trim()
  if (!normalized) return 'No preview available.'
  const previewLines = normalized.split('\n').slice(0, maxLines)
  const preview = previewLines.join('\n').slice(0, maxChars)
  return preview.length < normalized.length ? `${preview}\n…` : preview
}

export function isLargeArtifactContent(content: string): boolean {
  return content.length > CONTENT_PREVIEW_THRESHOLD
}

export function buildArtifactExport(artifact: CanvasArtifactRecord, target: ArtifactExportTarget, content: string): { filename: string; mimeType: string; content: string } {
  const stem = artifact.name.replace(/\.[^.]+$/, '') || artifact.name
  const summary = artifact.previewSummary ? `${artifact.previewSummary}\n\n` : ''

  if (target === 'memo') {
    return {
      filename: `${stem}-memo.txt`,
      mimeType: 'text/plain',
      content: [`Memo`, `Subject: ${stem}`, '', summary, content].join('\n'),
    }
  }

  if (target === 'dev-handoff') {
    return {
      filename: `${stem}-handoff.md`,
      mimeType: 'text/markdown',
      content: [
        `# Developer Handoff`,
        '',
        `- Artifact: ${artifact.name}`,
        `- Presentation: ${artifact.presentationType}`,
        artifact.bundleName ? `- Bundle: ${artifact.bundleName}` : '',
        artifact.bundleRole ? `- Role: ${artifact.bundleRole}` : '',
        '',
        '## Content',
        '',
        content,
      ].filter(Boolean).join('\n'),
    }
  }

  return {
    filename: `${stem}-report.md`,
    mimeType: 'text/markdown',
    content: [`# ${stem}`, '', summary, content].join('\n'),
  }
}

export function artifactSupportsTextEditing(artifact: CanvasArtifactRecord): boolean {
  return !artifact.mimeType.startsWith('image/')
}
