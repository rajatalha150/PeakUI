import { describe, expect, it } from 'vitest'
import { extractServerArtifactDownloads, rewriteBrokenArtifactLinks } from './ChatMessageContent'

describe('extractServerArtifactDownloads', () => {
  it('finds markdown and bare Canvas artifact download URLs', () => {
    const downloads = extractServerArtifactDownloads([
      'Download [tax-2025-review.pdf](/api/canvas/artifacts/art_123/download).',
      'Backup URL: /api/canvas/artifacts/art_456/download',
    ].join('\n'))

    expect(downloads).toEqual([
      { name: 'tax-2025-review.pdf', url: '/api/canvas/artifacts/art_123/download' },
      { name: 'server-artifact-2', url: '/api/canvas/artifacts/art_456/download' },
    ])
  })
})

describe('rewriteBrokenArtifactLinks', () => {
  const artifacts = new Map<string, string>([
    ['Linux-in-the-Enterprise.pptx', '/api/canvas/artifacts/cf23ea25-0fe1-4624-aaa0-35b342b4c18e/download'],
  ])

  it('rewrites an absolute URL hallucinated by the model to the correct relative download URL', () => {
    const input = '[Linux-in-the-Enterprise.pptx](https://gpt.dachicorp.com/Linux-in-the-Enterprise.pptx)'
    const out = rewriteBrokenArtifactLinks(input, artifacts)
    expect(out).toBe(
      '[Linux-in-the-Enterprise.pptx](/api/canvas/artifacts/cf23ea25-0fe1-4624-aaa0-35b342b4c18e/download)',
    )
  })

  it('rewrites a protocol-relative URL', () => {
    const input = '[Linux-in-the-Enterprise.pptx](//gpt.dachicorp.com/Linux-in-the-Enterprise.pptx)'
    const out = rewriteBrokenArtifactLinks(input, artifacts)
    expect(out).toBe(
      '[Linux-in-the-Enterprise.pptx](/api/canvas/artifacts/cf23ea25-0fe1-4624-aaa0-35b342b4c18e/download)',
    )
  })

  it('strips emoji decoration from the link text before matching', () => {
    const input = '[📥 Download Linux-in-the-Enterprise (.pptx)](https://gpt.dachicorp.com/Linux-in-the-Enterprise.pptx)'
    const out = rewriteBrokenArtifactLinks(input, artifacts)
    expect(out).toContain('/api/canvas/artifacts/cf23ea25-0fe1-4624-aaa0-35b342b4c18e/download')
    expect(out).not.toContain('https://gpt.dachicorp.com')
  })

  it('leaves already-correct relative download URLs alone', () => {
    const input = '[Linux-in-the-Enterprise.pptx](/api/canvas/artifacts/cf23ea25-0fe1-4624-aaa0-35b342b4c18e/download)'
    expect(rewriteBrokenArtifactLinks(input, artifacts)).toBe(input)
  })

  it('leaves links to non-artifact URLs alone', () => {
    const input = '[OpenAI](https://openai.com/about)'
    expect(rewriteBrokenArtifactLinks(input, artifacts)).toBe(input)
  })

  it('leaves links alone when the link text does not match any artifact', () => {
    const input = '[some-thing.pptx](https://example.com/some-thing.pptx)'
    expect(rewriteBrokenArtifactLinks(input, artifacts)).toBe(input)
  })

  it('returns the original content when the artifact map is empty', () => {
    const input = '[Linux-in-the-Enterprise.pptx](https://gpt.dachicorp.com/Linux-in-the-Enterprise.pptx)'
    expect(rewriteBrokenArtifactLinks(input, new Map())).toBe(input)
  })
})
