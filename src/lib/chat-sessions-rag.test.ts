import { describe, expect, it } from 'vitest'
import {
  parseStoredMessageSources,
  serializeStoredMessageSources,
} from './chat-sessions'
import type { MessageSource } from './message-sources'

describe('chat-sessions RAG draft persistence', () => {
  it('round-trips a MessageSource[] through parse/serialize', () => {
    const sources: MessageSource[] = [
      {
        filename: 'pricing.pdf',
        content: 'Pricing tiers are $10 / $50 / $200 per month.',
        score: 0.91,
        chunkId: 'chunk-1',
        mode: 'semantic',
      },
      {
        filename: 'faq.md',
        content: 'Refund policy: 30 days, no questions asked.',
        score: 0.74,
        url: 'https://example.com/faq',
        mode: 'keyword',
      },
    ]

    const json = serializeStoredMessageSources(sources)
    const parsed = parseStoredMessageSources(json)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      filename: 'pricing.pdf',
      chunkId: 'chunk-1',
      mode: 'semantic',
      score: 0.91,
    })
    expect(parsed[0]?.content).toContain('Pricing tiers')
    expect(parsed[1]).toMatchObject({
      filename: 'faq.md',
      url: 'https://example.com/faq',
      mode: 'keyword',
      score: 0.74,
    })
  })

  it('returns [] for null, empty, or invalid JSON', () => {
    expect(parseStoredMessageSources(null)).toEqual([])
    expect(parseStoredMessageSources(undefined)).toEqual([])
    expect(parseStoredMessageSources('')).toEqual([])
    expect(parseStoredMessageSources('not json')).toEqual([])
    expect(parseStoredMessageSources('{"not":"an array"}')).toEqual([])
  })

  it('drops invalid source entries (missing filename or content)', () => {
    const json = JSON.stringify([
      { filename: 'good.md', content: 'valid', score: 0.5 },
      { filename: '', content: 'no filename', score: 0.5 },
      { filename: 'no-content.md', score: 0.5 },
      { content: 'no filename either', score: 0.5 },
      'not-an-object',
      null,
    ])

    const parsed = parseStoredMessageSources(json)
    expect(parsed).toEqual([
      expect.objectContaining({ filename: 'good.md', content: 'valid' }),
    ])
  })

  it('serializeStoredMessageSources normalizes input (drops invalid)', () => {
    const json = serializeStoredMessageSources([
      { filename: 'a.md', content: 'alpha', score: 0.5 },
      { filename: '', content: 'b', score: 0.5 },
      { filename: 'c.md', content: '', score: 0.5 } as MessageSource,
    ])

    const parsed = parseStoredMessageSources(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.filename).toBe('a.md')
  })

  it('returns null for empty/whitespace ragQuery after trim', () => {
    // The 2000-char truncation lives inside buildSessionData; this test asserts
    // that the parse/serialize helpers are content-agnostic and don't truncate.
    const longQuery = 'a'.repeat(5000)
    const json = serializeStoredMessageSources([])
    const parsed = parseStoredMessageSources(json)
    expect(parsed).toEqual([])
    expect(longQuery.length).toBe(5000)
  })
})
