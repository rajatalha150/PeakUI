import { describe, expect, it } from 'vitest'
import {
  assertNonEmptyArtifactBytes,
  hasMeaningfulDocumentText,
  isPlaceholderDocumentText,
  isUsableArtifactRecord,
} from './document-generation-guard'

describe('document generation guards', () => {
  it('recognizes recovery placeholders', () => {
    expect(isPlaceholderDocumentText('auto-recovered from prose')).toBe(true)
    expect(isPlaceholderDocumentText('Quarterly results')).toBe(false)
    expect(hasMeaningfulDocumentText('Quarterly results')).toBe(true)
    expect(hasMeaningfulDocumentText('  ')).toBe(false)
  })

  it('rejects empty binary output', () => {
    expect(() => assertNonEmptyArtifactBytes(Buffer.alloc(0), 'PDF')).toThrow(/empty artifact/)
    expect(() => assertNonEmptyArtifactBytes(Buffer.alloc(128), 'PDF', 64)).not.toThrow()
  })

  it('requires a complete, relative Canvas artifact record', () => {
    const artifact = {
      id: 'artifact-1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 128,
      downloadUrl: '/api/canvas/artifacts/artifact-1/download',
    }
    expect(isUsableArtifactRecord(artifact)).toBe(true)
    expect(isUsableArtifactRecord({ ...artifact, size: 0 })).toBe(false)
    expect(isUsableArtifactRecord({ ...artifact, downloadUrl: 'https://example.test/report.pdf' })).toBe(false)
  })
})
