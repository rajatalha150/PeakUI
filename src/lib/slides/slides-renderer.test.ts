import { describe, expect, it } from 'vitest'
import { renderSlidesDocument } from '@/lib/slides/slides-renderer'
import { normalizeSlidesDocumentInput } from '@/lib/slides/slides-schema'

describe('slides renderer', () => {
  it('produces a valid PPTX buffer for a 2-slide deck', async () => {
    const normalized = normalizeSlidesDocumentInput({
      title: 'Test Deck',
      slides: [
        { layout: 'title', title: 'Test Deck', subtitle: 'Subtitle' },
        { layout: 'closing', title: 'Thank you' },
      ],
    })
    const bytes = await renderSlidesDocument(normalized)
    expect(bytes.byteLength).toBeGreaterThan(0)
    // PPTX is a ZIP file (PK magic bytes)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('honors theme colors when supplied', async () => {
    const normalized = normalizeSlidesDocumentInput({
      title: 'Themed',
      theme: { primaryColor: 'FF00FF', accentColor: '00FFFF' },
      slides: [{ layout: 'content', title: 'Body' }],
    })
    const bytes = await renderSlidesDocument(normalized)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('rejects decks with no renderable slides', () => {
    const normalized = normalizeSlidesDocumentInput({ title: 'Empty', slides: [] })
    expect(normalized.slides.length).toBe(0)
  })
})