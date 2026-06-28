import { describe, it, expect } from 'vitest'
import { decodeArtifactContent, isTextArtifactMimeType, sanitizeDownloadName } from './canvas-download'

describe('isTextArtifactMimeType', () => {
  it('treats text/* as text', () => {
    expect(isTextArtifactMimeType('text/plain')).toBe(true)
    expect(isTextArtifactMimeType('text/markdown')).toBe(true)
    expect(isTextArtifactMimeType('text/html')).toBe(true)
    expect(isTextArtifactMimeType('text/csv')).toBe(true)
  })

  it('treats JSON / XML / JS / markdown mime types as text', () => {
    expect(isTextArtifactMimeType('application/json')).toBe(true)
    expect(isTextArtifactMimeType('application/xml')).toBe(true)
    expect(isTextArtifactMimeType('application/javascript')).toBe(true)
    expect(isTextArtifactMimeType('application/x-javascript')).toBe(true)
    expect(isTextArtifactMimeType('application/ld+json')).toBe(true)
    expect(isTextArtifactMimeType('application/markdown')).toBe(true)
    expect(isTextArtifactMimeType('image/svg+xml')).toBe(true)
  })

  it('treats Office Open XML formats as binary (the regression)', () => {
    // Regression: pptx used to fall through to the text branch and produced
    // the "UEsDBAoAA..." raw base64 download seen by users.
    expect(isTextArtifactMimeType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe(false)
    expect(isTextArtifactMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false)
    expect(isTextArtifactMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
    expect(isTextArtifactMimeType('application/vnd.ms-excel')).toBe(false)
    expect(isTextArtifactMimeType('application/msword')).toBe(false)
  })

  it('treats ZIP, PDF, ICS, EML, and images as binary', () => {
    expect(isTextArtifactMimeType('application/zip')).toBe(false)
    expect(isTextArtifactMimeType('application/pdf')).toBe(false)
    expect(isTextArtifactMimeType('text/calendar')).toBe(true) // ICS is text/calendar — handled as text body
    expect(isTextArtifactMimeType('message/rfc822')).toBe(false) // EML
    expect(isTextArtifactMimeType('image/png')).toBe(false)
    expect(isTextArtifactMimeType('image/jpeg')).toBe(false)
  })

  it('treats unknown / null mime types as binary', () => {
    expect(isTextArtifactMimeType(undefined)).toBe(false)
    expect(isTextArtifactMimeType(null)).toBe(false)
    expect(isTextArtifactMimeType('')).toBe(false)
    expect(isTextArtifactMimeType('application/x-totally-made-up')).toBe(false)
  })

  it('handles case-insensitive mime types', () => {
    expect(isTextArtifactMimeType('Application/JSON')).toBe(true)
    expect(isTextArtifactMimeType('TEXT/PLAIN')).toBe(true)
  })
})

describe('decodeArtifactContent', () => {
  it('returns UTF-8 bytes for text mime types', () => {
    const out = decodeArtifactContent('hello\nworld', 'text/plain')
    expect(out.toString('utf8')).toBe('hello\nworld')
  })

  it('base64-decodes PPTX content (regression)', () => {
    // PK\x03\x04 is the ZIP magic — every valid PPTX starts with this.
    const pptxBytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]),
      Buffer.from('rest of zip body'),
    ])
    const stored = pptxBytes.toString('base64')
    const decoded = decodeArtifactContent(stored, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(decoded.subarray(0, 4).toString('hex')).toBe('504b0304')
    expect(decoded.toString('utf8').includes('rest of zip body')).toBe(true)
  })

  it('base64-decodes ZIP content', () => {
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    const stored = zipBytes.toString('base64')
    const decoded = decodeArtifactContent(stored, 'application/zip')
    expect(decoded.subarray(0, 4).toString('hex')).toBe('504b0304')
  })

  it('base64-decodes a realistic 41 KB PPTX (the regression)', () => {
    // The bug the user reported: a 41 KB PPTX downloaded as "UEsDBAoAA..."
    // text. Reproduce by encoding random bytes to base64 and verifying the
    // decoder recovers the original ZIP magic and length.
    const bytes = Buffer.alloc(41719, 0)
    // Sprinkle in some real ZIP-looking entries
    bytes.write('PK\x03\x04', 0, 'binary')
    bytes.write('PK\x05\x06', 1000, 'binary')
    const stored = bytes.toString('base64')
    const decoded = decodeArtifactContent(stored, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(decoded.byteLength).toBe(41719)
    expect(decoded.subarray(0, 4).toString('hex')).toBe('504b0304')
  })

  it('base64-decodes EML (message/rfc822)', () => {
    const eml = Buffer.from('From: a@b\r\nTo: c@d\r\n\r\nbody')
    const stored = eml.toString('base64')
    const decoded = decodeArtifactContent(stored, 'message/rfc822')
    expect(decoded.toString('utf8').startsWith('From: a@b')).toBe(true)
  })

  it('base64-decodes PDF content', () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n%fake')
    const stored = pdfBytes.toString('base64')
    const decoded = decodeArtifactContent(stored, 'application/pdf')
    expect(decoded.toString('utf8').startsWith('%PDF-1.4')).toBe(true)
  })

  it('strips whitespace from base64 before decoding', () => {
    // Some DB stores insert line breaks every 76 chars
    const stored = 'SGVs bG8g V29y bGQ='
    const decoded = decodeArtifactContent(stored, 'application/octet-stream')
    expect(decoded.toString('utf8')).toBe('Hello World')
  })

  it('passes CSV through as UTF-8 when stored as text', () => {
    // New behavior: csv-artifacts.ts now stores CSV as UTF-8 string.
    const stored = 'name,age\nAlice,30\nBob,25\n'
    const decoded = decodeArtifactContent(stored, 'text/csv')
    expect(decoded.toString('utf8')).toBe(stored)
  })

  it('passes ICS through as UTF-8 when stored as text', () => {
    const stored = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
    const decoded = decodeArtifactContent(stored, 'text/calendar')
    expect(decoded.toString('utf8')).toBe(stored)
  })

  it('decodes legacy base64-stored CSV/ICS artifacts', () => {
    // Backward compat: before this helper, csv/ics were stored as base64
    // strings even though their mime types were text/csv and text/calendar.
    // The decoder detects that pattern and base64-decodes them so legacy
    // rows keep opening correctly.
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:legacy\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    const legacy = Buffer.from(ics, 'utf8').toString('base64')
    const decoded = decodeArtifactContent(legacy, 'text/calendar')
    expect(decoded.toString('utf8')).toBe(ics)
  })

  it('decodes legacy base64-stored JSON artifacts', () => {
    const json = '{"hello":"world","n":42}\n'
    const legacy = Buffer.from(json, 'utf8').toString('base64')
    const decoded = decodeArtifactContent(legacy, 'application/json')
    expect(decoded.toString('utf8')).toBe(json)
  })

  it('does not double-decode UTF-8 text that happens to look like base64', () => {
    // A short string that *could* parse as base64 but is genuinely meant as
    // text. We must not mangle these. The heuristic requires the raw head to
    // look like a base64 burst AND decoded to look more text-like.
    const notActuallyBase64 = 'Hello world'
    const decoded = decodeArtifactContent(notActuallyBase64, 'text/plain')
    expect(decoded.toString('utf8')).toBe('Hello world')
  })
})

describe('sanitizeDownloadName', () => {
  it('strips path separators', () => {
    expect(sanitizeDownloadName('../etc/passwd')).toBe('passwd')
    expect(sanitizeDownloadName('C:\\Users\\me\\foo.pptx')).toBe('foo.pptx')
    expect(sanitizeDownloadName('a/b/c.pptx')).toBe('c.pptx')
  })

  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeDownloadName('hello;rm -rf;.pptx')).toBe('hello_rm -rf_.pptx')
    expect(sanitizeDownloadName('safe-name (1).pptx')).toBe('safe-name (1).pptx')
  })

  it('falls back to "artifact" for empty names', () => {
    expect(sanitizeDownloadName('')).toBe('artifact')
    expect(sanitizeDownloadName('   ')).toBe('artifact')
    expect(sanitizeDownloadName('////')).toBe('artifact')
  })

  it('caps length at 180 chars', () => {
    const long = 'a'.repeat(500) + '.pptx'
    expect(sanitizeDownloadName(long).length).toBeLessThanOrEqual(180)
  })
})
