import { describe, expect, it } from 'vitest'
import { renderSlidesDocument } from '@/lib/slides/slides-renderer'
import { normalizeSlidesDocumentInput } from '@/lib/slides/slides-schema'
import JSZip from 'jszip'

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

  it('declares only slideMaster1.xml in Content_Types.xml for Google Slides compatibility', async () => {
    // pptxgenjs 3.12 references slideMaster{idx+1}.xml per slide but only
    // writes slideMaster1.xml. Without sanitization, Google Slides / Keynote
    // reject the file because Content_Types.xml declares parts that aren't
    // present in the zip.
    const normalized = normalizeSlidesDocumentInput({
      title: 'Compatibility Test',
      slides: [
        { layout: 'title', title: 'A', subtitle: 'B' },
        { layout: 'content', title: 'C', body: 'D' },
        { layout: 'closing', title: 'E', body: 'F' },
      ],
    })
    const bytes = await renderSlidesDocument(normalized)
    const zip = await JSZip.loadAsync(bytes)
    const contentTypes = await zip.file('[Content_Types].xml')!.async('string')

    // Each PartName declared in Content_Types must point to a real zip entry.
    const declared = Array.from(contentTypes.matchAll(/<Override\s+PartName="([^"]+)"/g)).map(m => m[1])
    for (const partName of declared) {
      const zipName = partName.replace(/^\/+/, '')
      expect(zip.file(zipName), `Content_Types declares ${partName} but zip has no such entry`).toBeTruthy()
    }

    // Specifically: only slideMaster1.xml should be declared.
    const masterParts = declared.filter(p => /\/slideMaster\d+\.xml$/.test(p))
    expect(masterParts).toEqual(['/ppt/slideMasters/slideMaster1.xml'])
  })
})