export type SlidesLayout =
  | 'title'
  | 'section'
  | 'content'
  | 'two-column'
  | 'bullets'
  | 'quote'
  | 'closing'

export interface SlidesSlideColumn {
  heading?: string
  bullets?: string[]
  body?: string
}

export interface SlidesSlide {
  layout: SlidesLayout
  title?: string
  subtitle?: string
  body?: string
  bullets?: string[]
  columns?: SlidesSlideColumn[]
  quote?: string
  attribution?: string
  notes?: string
}

export interface SlidesTheme {
  primaryColor?: string
  accentColor?: string
  backgroundColor?: string
  textColor?: string
  fontFace?: string
  author?: string
  company?: string
}

export interface SlidesDocumentInput {
  title: string
  subtitle?: string
  author?: string
  company?: string
  theme?: SlidesTheme
  slides: SlidesSlide[]
  filename?: string
  description?: string
}

export interface NormalizedSlidesDocument {
  title: string
  subtitle?: string
  author?: string
  company?: string
  theme: SlidesTheme
  slides: SlidesSlide[]
  filename?: string
  description?: string
}

const SLIDE_LAYOUTS = new Set<SlidesLayout>(['title', 'section', 'content', 'two-column', 'bullets', 'quote', 'closing'])

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

function normalizeColumn(value: unknown): SlidesSlideColumn | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const heading = cleanString(record.heading, 200)
  const body = cleanString(record.body, 4000)
  const bullets = Array.isArray(record.bullets)
    ? record.bullets.flatMap(item => {
      const clean = cleanString(item, 600)
      return clean ? [clean] : []
    }).slice(0, 20)
    : undefined
  if (!heading && !body && !(bullets && bullets.length)) return null
  return { heading, body, bullets }
}

function normalizeSlide(value: unknown): SlidesSlide | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const layout = typeof record.layout === 'string' && SLIDE_LAYOUTS.has(record.layout as SlidesLayout)
    ? record.layout as SlidesLayout
    : 'content'

  const title = cleanString(record.title, 240)
  const subtitle = cleanString(record.subtitle, 240)
  const body = cleanString(record.body, 8000)
  const bullets = Array.isArray(record.bullets)
    ? record.bullets.flatMap(item => {
      const clean = cleanString(item, 600)
      return clean ? [clean] : []
    }).slice(0, 30)
    : undefined
  const columns = Array.isArray(record.columns)
    ? record.columns.map(normalizeColumn).filter((col): col is SlidesSlideColumn => Boolean(col)).slice(0, 2)
    : undefined
  const quote = cleanString(record.quote, 1200)
  const attribution = cleanString(record.attribution, 240)
  const notes = cleanString(record.notes, 4000)

  const hasContent = Boolean(title || subtitle || body || (bullets && bullets.length) || (columns && columns.length) || quote)
  if (!hasContent) return null

  return { layout, title, subtitle, body, bullets, columns, quote, attribution, notes }
}

function normalizeTheme(value: unknown): SlidesTheme {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    primaryColor: cleanString(record.primaryColor, 32),
    accentColor: cleanString(record.accentColor, 32),
    backgroundColor: cleanString(record.backgroundColor, 32),
    textColor: cleanString(record.textColor, 32),
    fontFace: cleanString(record.fontFace, 80),
    author: cleanString(record.author, 160),
    company: cleanString(record.company, 160),
  }
}

export function normalizeSlidesDocumentInput(input: SlidesDocumentInput): NormalizedSlidesDocument {
  const slides = Array.isArray(input.slides) ? input.slides.map(normalizeSlide).filter((s): s is SlidesSlide => Boolean(s)).slice(0, 60) : []
  return {
    title: (typeof input.title === 'string' ? input.title.trim() : '').slice(0, 200) || 'Untitled Deck',
    subtitle: cleanString(input.subtitle, 240),
    author: cleanString(input.author, 160),
    company: cleanString(input.company, 160),
    theme: normalizeTheme(input.theme),
    slides,
    filename: cleanString(input.filename, 180),
    description: cleanString(input.description, 800),
  }
}

export function slidesDocumentHasRenderableContent(document: NormalizedSlidesDocument): boolean {
  return document.slides.length > 0
}