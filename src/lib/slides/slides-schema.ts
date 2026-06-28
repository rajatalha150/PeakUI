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

function normalizeBullets(value: unknown, maxItems: number): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim()
      // Split strings like "one\n- two\n* three" or numbered lists into bullets
      // so a model that forgot to send an array still produces a usable slide.
      ? value
        .split(/\r?\n+/)
        .flatMap(line => line.split(/(?:^|\s)[•\-*]\s+|\s\d+[.)]\s+/))
        .map(s => s.replace(/^[•\-*]\s+/, '').trim())
        .filter(Boolean)
      : [])
  if (!raw.length) return undefined
  const clean = raw.flatMap(item => {
    const text = cleanString(item, 600)
    return text ? [text] : []
  }).slice(0, maxItems)
  return clean.length ? clean : undefined
}

function normalizeColumn(value: unknown): SlidesSlideColumn | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const heading = cleanString(record.heading, 200) || cleanString(record.title, 200)
  // body/text/subtitle all map to the same long-form prose field.
  const body = cleanString(record.body, 4000)
    ?? cleanString(record.text, 4000)
    ?? cleanString(record.subtitle, 4000)
  // bullets/content/items/points all map to the bullet array so models that
  // use any of the natural alternatives still produce a renderable slide.
  const bullets = normalizeBullets(record.bullets ?? record.content ?? record.items ?? record.points, 20)
  if (!heading && !body && !(bullets && bullets.length)) return null
  return { heading, body, bullets }
}

function normalizeSlide(value: unknown): SlidesSlide | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  // Accept common layout aliases so a slightly-wrong payload still renders.
  const rawLayout = typeof record.layout === 'string' ? record.layout.toLowerCase().trim() : ''
  const layoutAlias: Record<string, SlidesLayout> = {
    'content': 'content',
    'paragraph': 'content',
    'text': 'content',
    'bullets': 'bullets',
    'list': 'bullets',
    'bullet': 'bullets',
    'two-column': 'two-column',
    'twocolumn': 'two-column',
    'columns': 'two-column',
    'two_col': 'two-column',
    'title': 'title',
    'cover': 'title',
    'section': 'section',
    'divider': 'section',
    'closing': 'closing',
    'end': 'closing',
    'thank-you': 'closing',
    'thank_you': 'closing',
    'quote': 'quote',
    'testimonial': 'quote',
  }
  const layout = (rawLayout && layoutAlias[rawLayout]) || (SLIDE_LAYOUTS.has(rawLayout as SlidesLayout) ? rawLayout as SlidesLayout : 'content')

  const title = cleanString(record.title, 240) ?? cleanString(record.heading, 240)
  const subtitle = cleanString(record.subtitle, 240)
  // body/text/paragraph all map to long-form prose.
  const body = cleanString(record.body, 8000)
    ?? cleanString(record.text, 8000)
    ?? cleanString(record.paragraph, 8000)
  // bullets/content/items/points/values all map to the bullet array so the
  // model's natural prose-style payload still produces a slide.
  const bullets = normalizeBullets(record.bullets ?? record.content ?? record.items ?? record.points ?? record.values, 30)
  const columns = Array.isArray(record.columns)
    ? record.columns.map(normalizeColumn).filter((col): col is SlidesSlideColumn => Boolean(col)).slice(0, 2)
    : undefined
  const quote = cleanString(record.quote, 1200)
    ?? cleanString(record.testimonial, 1200)
    ?? cleanString(record.text, 1200)
  const attribution = cleanString(record.attribution, 240) ?? cleanString(record.author, 240)
  const notes = cleanString(record.notes, 4000) ?? cleanString(record.speakerNotes, 4000)

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