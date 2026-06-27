import PPTXGenJS from 'pptxgenjs'
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

  pptx.defineSlideMaster({
    title: 'BASE',
    background: { color: bg },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.4, fill: { color: primary } } },
      { rect: { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: primary } } },
    ],
  })

  for (const slide of document.slides) {
    renderSlide(pptx, slide, { primary, accent, fg, fontFace })
  }

  const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' })
  return Buffer.from(arrayBuffer as ArrayBuffer)
}

interface RenderContext {
  primary: string
  accent: string
  fg: string
  fontFace: string
}

function renderSlide(pptx: PPTXGenJS, slide: SlidesSlide, ctx: RenderContext): void {
  const s = pptx.addSlide({ masterName: 'BASE' })

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