/**
 * Shared guards for generated Canvas artifacts.
 *
 * A renderer can technically produce a valid file from a title alone. That is
 * not a successful generation from the user's point of view, so recovery
 * placeholders and empty binary payloads must be rejected before they enter
 * the artifact store or the agent's success path.
 */

const PLACEHOLDER_TEXT = /^(?:auto-recovered\b|generated from prose\b|placeholder\b|<[^>]+>)/i

export function isPlaceholderDocumentText(value: unknown): boolean {
  return typeof value === 'string' && PLACEHOLDER_TEXT.test(value.trim())
}

export function hasMeaningfulDocumentText(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return text.length >= 3 && !isPlaceholderDocumentText(text)
}

export function assertNonEmptyArtifactBytes(
  bytes: Uint8Array,
  label: string,
  minimumBytes = 1,
): void {
  if (!bytes || bytes.byteLength < minimumBytes) {
    throw new Error(`${label} renderer returned an empty artifact`)
  }
}

export function isUsableArtifactRecord(value: unknown): value is {
  id: string
  name: string
  mimeType: string
  size: number
  downloadUrl: string
} {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Record<string, unknown>
  return typeof artifact.id === 'string'
    && artifact.id.length > 0
    && typeof artifact.name === 'string'
    && artifact.name.length > 0
    && typeof artifact.mimeType === 'string'
    && artifact.mimeType.length > 0
    && typeof artifact.size === 'number'
    && Number.isFinite(artifact.size)
    && artifact.size > 0
    && typeof artifact.downloadUrl === 'string'
    && artifact.downloadUrl.startsWith('/api/canvas/artifacts/')
}
