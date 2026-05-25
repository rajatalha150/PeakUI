export const CANVAS_ARTIFACT_DEFAULT_LIMIT = 50
export const CANVAS_ARTIFACT_MAX_LIMIT = 200
export const CANVAS_ARTIFACT_CONTENT_LIMIT = 10_000_000

export interface CanvasArtifactListParams {
  sessionId: string | null
  limit: number
  cursor: string | null
  query: string
  presentationType: string | null
  bundleId: string | null
}

function normalizeLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return CANVAS_ARTIFACT_DEFAULT_LIMIT
  return Math.min(Math.max(parsed, 1), CANVAS_ARTIFACT_MAX_LIMIT)
}

function normalizeOptionalText(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function normalizeCanvasArtifactListParams(searchParams: URLSearchParams): CanvasArtifactListParams {
  return {
    sessionId: normalizeOptionalText(searchParams.get('sessionId')),
    limit: normalizeLimit(searchParams.get('limit')),
    cursor: normalizeOptionalText(searchParams.get('cursor')),
    query: normalizeOptionalText(searchParams.get('q')) ?? '',
    presentationType: normalizeOptionalText(searchParams.get('presentationType')),
    bundleId: normalizeOptionalText(searchParams.get('bundleId')),
  }
}
