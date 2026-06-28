import PPTXGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import type { NormalizedSlidesDocument, SlidesSlide } from './slides-schema'

export async function renderSlidesDocument(document: NormalizedSlidesDocument): Promise<Buffer> {
  const pptx = new PPTXGenJS()
  pptx.author = document.theme.author || document.author || 'PeakUI'
  pptx.company = document.theme.company || document.company || 'PeakUI'
  pptx.title = document.title
  if (document.subtitle) pptx.subject = document.subtitle

  const primary = document.theme.primaryColor || '1E3A8A'
  const accent = document.theme.accentColor || '0EA5E9'
  const bg = document.theme.backgroundColor || 'FFFFFF'
  const fg = document.theme.textColor || '0F172A'
  const fontFace = document.theme.fontFace || 'Calibri'

  // NOTE: We deliberately do NOT call `pptx.defineSlideMaster` here. pptxgenjs
  // 3.12 has a known bug where iterating over slides in Content_Types.xml
  // generation adds a `slideMaster{idx+1}.xml` Override per slide, but only
  // `slideMaster1.xml` is actually written to the zip. Strict OOXML readers
  // (Google Slides, Apple Keynote import) reject the resulting package
  // because the Content_Types declarations don't match the on-disk files.
  // Instead, each slide draws its own background bars via addShape.
  pptx.defineLayout({ name: 'PEAKUI_BLANK', width: 13.33, height: 7.5 })

  for (const slide of document.slides) {
    renderSlide(pptx, slide, { primary, accent, bg, fg, fontFace })
  }

  const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' })
  const rawBuffer: Buffer = Buffer.from(arrayBuffer as ArrayBuffer)

  // Defense in depth: even when defineSlideMaster is not used, strip any
  // phantom slideMaster overrides from Content_Types.xml. This guarantees
  // Google Slides / Keynote / Numbers can import the file without "package
  // is invalid" errors.
  return sanitizePptxContentTypes(rawBuffer)
}

/**
 * Post-process a pptxgenjs-generated `.pptx` buffer so the
 * `[Content_Types].xml` declarations match the files actually present in the
 * zip. pptxgenjs 3.12 references a `slideMaster{idx+1}.xml` for every slide
 * but only writes `slideMaster1.xml`, so we drop the phantom entries.
 *
 * Also drops any other Override entries whose PartName does not exist in the
 * zip (defensive — covers future pptxgenjs regressions as well).
 */
async function sanitizePptxContentTypes(buffer: Buffer): Promise<Buffer> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return buffer
  }

  const contentTypesEntry = zip.file('[Content_Types].xml')
  if (!contentTypesEntry) return buffer

  const contentTypesXml = await contentTypesEntry.async('string')
  // Build a set of PartNames that match actual zip entries. JSZip stores
  // entries with their folder paths, so a PartName of "/ppt/slides/slide1.xml"
  // maps to the zip entry "ppt/slides/slide1.xml" (no leading slash).
  const existingPartNames = new Set<string>()
  for (const name of Object.keys(zip.files)) {
    if (!name || name.endsWith('/')) continue // skip directory placeholders
    existingPartNames.add('/' + name.replace(/^\/+/, '').replace(/\\/g, '/'))
  }

  // The regex captures the full <Override ... /> element regardless of how
  // many "/" characters appear inside the ContentType attribute. Earlier
  // versions used `[^/]*` which stopped at the first "/" inside the URL-ish
  // ContentType and silently matched nothing.
  const overridePattern = /<Override\s+PartName="([^"]+)"[^>]*?\/>/g
  let removed = 0
  const sanitized = contentTypesXml.replace(overridePattern, (match, partName: string) => {
    if (existingPartNames.has(partName)) return match
    removed += 1
    return ''
  })

  if (removed === 0) return buffer

  zip.file('[Content_Types].xml', sanitized)
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return out
}

interface RenderContext {
  primary: string
  accent: string
  bg: string
  fg: string
  fontFace: string
}

function renderSlide(pptx: PPTXGenJS, slide: SlidesSlide, ctx: RenderContext): void {
  // Use the blank layout so each slide draws its own background bars and we
  // don't depend on pptxgenjs' slide-master support (which has a broken
  // Content_Types.xml generator that Google Slides / Keynote reject).
  const s = pptx.addSlide({ masterName: 'PEAKUI_BLANK' })

  // Background fill (one rect over the whole slide) plus the two decorative
  // top/bottom bars previously rendered via defineSlideMaster.
  s.background = { color: ctx.bg }
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 0.4, fill: { color: ctx.primary }, line: { color: ctx.primary, width: 0 },
  })
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: ctx.primary }, line: { color: ctx.primary, width: 0 },
  })

  switch (slide.layout) {
    case 'title':
      s.addText(slide.title ?? '', {
        x: 0.5, y: 1.8, w: 12.33, h: 2,
        fontFace: ctx.fontFace, fontSize: 48, bold: true, color: ctx.fg, align: 'center', valign: 'middle',
      })
      if (slide.subtitle) {
        s.addText(slide.subtitle, {
          x: 0.5, y: 4.0, w: 12.33, h: 1,
          fontFace: ctx.fontFace, fontSize: 22, color: ctx.accent, align: 'center', italic: true,
        })
      }
      if (slide.body) {
        s.addText(slide.body, {
          x: 1.5, y: 5.2, w: 10.33, h: 1.5,
          fontFace: ctx.fontFace, fontSize: 16, color: ctx.fg, align: 'center',
        })
      }
      break
    case 'section':
      s.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: ctx.primary }, line: { color: ctx.primary, width: 0 },
      })
      s.addText(slide.title ?? '', {
        x: 0.5, y: 2.5, w: 12.33, h: 1.5,
        fontFace: ctx.fontFace, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
      })
      if (slide.subtitle) {
        s.addText(slide.subtitle, {
          x: 0.5, y: 4.2, w: 12.33, h: 0.8,
          fontFace: ctx.fontFace, fontSize: 20, color: 'F8FAFC', align: 'center',
        })
      }
      break
    case 'closing':
      s.addText(slide.title ?? 'Thank you', {
        x: 0.5, y: 2.8, w: 12.33, h: 1.5,
        fontFace: ctx.fontFace, fontSize: 48, bold: true, color: ctx.primary, align: 'center',
      })
      if (slide.body) {
        s.addText(slide.body, {
          x: 1.5, y: 4.6, w: 10.33, h: 1.5,
          fontFace: ctx.fontFace, fontSize: 18, color: ctx.fg, align: 'center',
        })
      }
      break
    case 'bullets':
      if (slide.title) {
        s.addText(slide.title, {
          x: 0.6, y: 0.7, w: 12.13, h: 0.9,
          fontFace: ctx.fontFace, fontSize: 32, bold: true, color: ctx.primary,
        })
      }
      if (slide.bullets && slide.bullets.length) {
        s.addText(
          slide.bullets.map(text => ({ text, options: { bullet: { code: '25A0' }, color: ctx.fg } })),
          {
            x: 0.8, y: 1.8, w: 11.73, h: 5.0,
            fontFace: ctx.fontFace, fontSize: 22, color: ctx.fg, paraSpaceAfter: 12,
            valign: 'top',
          },
        )
      }
      break
    case 'two-column':
      if (slide.title) {
        s.addText(slide.title, {
          x: 0.6, y: 0.7, w: 12.13, h: 0.9,
          fontFace: ctx.fontFace, fontSize: 32, bold: true, color: ctx.primary,
        })
      }
      const cols = slide.columns ?? []
      const colWidth = 5.8
      cols.forEach((col, index) => {
        const x = 0.6 + index * (colWidth + 0.6)
        if (col.heading) {
          s.addText(col.heading, {
            x, y: 1.8, w: colWidth, h: 0.6,
            fontFace: ctx.fontFace, fontSize: 22, bold: true, color: ctx.accent,
          })
        }
        const startY = col.heading ? 2.6 : 1.8
        if (col.bullets && col.bullets.length) {
          s.addText(
            col.bullets.map(text => ({ text, options: { bullet: { code: '2022' }, color: ctx.fg } })),
            {
              x, y: startY, w: colWidth, h: 4.5,
              fontFace: ctx.fontFace, fontSize: 16, color: ctx.fg, paraSpaceAfter: 8,
            },
          )
        } else if (col.body) {
          s.addText(col.body, {
            x, y: startY, w: colWidth, h: 4.5,
            fontFace: ctx.fontFace, fontSize: 16, color: ctx.fg,
          })
        }
      })
      break
    case 'quote':
      if (slide.quote) {
        s.addText(`"${slide.quote}"`, {
          x: 1.0, y: 2.0, w: 11.33, h: 3.0,
          fontFace: ctx.fontFace, fontSize: 28, italic: true, color: ctx.fg, align: 'center', valign: 'middle',
        })
      }
      if (slide.attribution) {
        s.addText(`— ${slide.attribution}`, {
          x: 1.0, y: 5.2, w: 11.33, h: 0.6,
          fontFace: ctx.fontFace, fontSize: 18, color: ctx.accent, align: 'center',
        })
      }
      break
    case 'content':
    default:
      if (slide.title) {
        s.addText(slide.title, {
          x: 0.6, y: 0.7, w: 12.13, h: 0.9,
          fontFace: ctx.fontFace, fontSize: 32, bold: true, color: ctx.primary,
        })
      }
      const bodyStart = slide.title ? 1.8 : 0.8
      if (slide.body) {
        s.addText(slide.body, {
          x: 0.8, y: bodyStart, w: 11.73, h: 5.0,
          fontFace: ctx.fontFace, fontSize: 20, color: ctx.fg,
        })
      }
      if (slide.bullets && slide.bullets.length) {
        s.addText(
          slide.bullets.map(text => ({ text, options: { bullet: { code: '2022' }, color: ctx.fg } })),
          {
            x: 0.8, y: slide.body ? 3.5 : bodyStart, w: 11.73, h: 3.2,
            fontFace: ctx.fontFace, fontSize: 18, color: ctx.fg, paraSpaceAfter: 8,
          },
        )
      }
      break
  }

  if (slide.notes) {
    s.addNotes(slide.notes)
  }
}