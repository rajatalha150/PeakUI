import { describe, expect, it } from 'vitest'
import { extractServerArtifactDownloads } from './ChatMessageContent'

describe('extractServerArtifactDownloads', () => {
  it('finds markdown and bare Canvas artifact download URLs', () => {
    const downloads = extractServerArtifactDownloads([
      'Download [tax-2025-review.pdf](/api/canvas/artifacts/art_123/download).',
      'Backup URL: /api/canvas/artifacts/art_456/download',
    ].join('\n'))

    expect(downloads).toEqual([
      { name: 'tax-2025-review.pdf', url: '/api/canvas/artifacts/art_123/download' },
      { name: 'server-artifact-2.pdf', url: '/api/canvas/artifacts/art_456/download' },
    ])
  })
})
