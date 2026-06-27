import { describe, expect, it } from 'vitest'
import { renderArchiveDocument } from '@/lib/archive/archive-renderer'
import { normalizeArchiveDocumentInput } from '@/lib/archive/archive-schema'

describe('archive renderer', () => {
  it('produces a valid ZIP file', async () => {
    const normalized = normalizeArchiveDocumentInput({
      title: 'Bundle',
      entries: [
        { name: 'hello.txt', mimeType: 'text/plain', content: 'Hello, world!' },
        { name: 'note.md', mimeType: 'text/markdown', content: '# Heading\n\nBody' },
      ],
    })
    const bytes = await renderArchiveDocument(normalized)
    expect(bytes.byteLength).toBeGreaterThan(0)
    // ZIP magic bytes (PK\x03\x04)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
  })

  it('decodes base64 entries into binary buffers', async () => {
    const normalized = normalizeArchiveDocumentInput({
      title: 'Mixed',
      entries: [
        { name: 'logo.png', mimeType: 'image/png', content: 'iVBORw0KGgo=' },
        { name: 'info.txt', mimeType: 'text/plain', content: 'plain text body' },
      ],
    })
    const bytes = await renderArchiveDocument(normalized)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})