export interface EmailDocumentInput {
  title?: string
  filename?: string
  description?: string
  to?: string
  from?: string
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  htmlBody?: string
  attachments?: Array<{
    filename: string
    mimeType?: string
    content: string
  }>
}

export interface NormalizedEmailDocument {
  title: string
  filename?: string
  description?: string
  to: string
  from: string
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  htmlBody?: string
  attachments: Array<{
    filename: string
    mimeType: string
    content: string
  }>
}

const MAX_EMAIL_CHARS = 60_000

function cleanString(value: unknown, maxLength = 4000): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function cleanEmailAddress(value: unknown): string {
  const text = cleanString(value, 320)
  if (!text) return ''
  // Basic permissive email-like check
  return text.includes('@') || text.includes('<') ? text : ''
}

export function normalizeEmailDocumentInput(input: EmailDocumentInput): NormalizedEmailDocument {
  const subject = cleanString(input.subject, 400)
  const body = typeof input.body === 'string' ? input.body.trim().slice(0, MAX_EMAIL_CHARS) : ''
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim().slice(0, 160)
    : (subject || 'Generated Email')

  const cc = Array.isArray(input.cc)
    ? input.cc.map(cleanEmailAddress).filter(Boolean)
    : []
  const bcc = Array.isArray(input.bcc)
    ? input.bcc.map(cleanEmailAddress).filter(Boolean)
    : []

  const attachments: NormalizedEmailDocument['attachments'] = []
  if (Array.isArray(input.attachments)) {
    for (const attachment of input.attachments) {
      if (attachment && typeof attachment === 'object'
        && typeof (attachment as { filename?: string }).filename === 'string'
        && typeof (attachment as { content?: string }).content === 'string') {
        attachments.push({
          filename: (attachment as { filename: string }).filename.trim().slice(0, 180),
          mimeType: cleanString((attachment as { mimeType?: string }).mimeType, 120) || 'application/octet-stream',
          content: (attachment as { content: string }).content,
        })
      }
    }
  }

  return {
    title,
    filename: typeof input.filename === 'string' && input.filename.trim()
      ? input.filename.trim().slice(0, 180)
      : undefined,
    description: typeof input.description === 'string' && input.description.trim()
      ? input.description.trim().slice(0, 400)
      : undefined,
    to: cleanEmailAddress(input.to),
    from: cleanEmailAddress(input.from),
    cc,
    bcc,
    subject,
    body,
    htmlBody: typeof input.htmlBody === 'string' && input.htmlBody.trim()
      ? input.htmlBody.trim().slice(0, MAX_EMAIL_CHARS)
      : undefined,
    attachments,
  }
}

export function emailDocumentHasRenderableContent(document: NormalizedEmailDocument): boolean {
  return document.subject.trim().length > 0 && document.body.trim().length > 0
}

/**
 * Ensures an email document has renderable content. The full structure is a
 * strong recommendation, not a requirement: a title alone (optionally with a
 * description) is enough to generate a valid .eml draft. Defaults the subject
 * from the title and the body from the description when either is missing.
 */
export function ensureEmailRenderableContent(document: NormalizedEmailDocument): void {
  if (emailDocumentHasRenderableContent(document)) return
  if (!document.subject.trim()) {
    document.subject = document.title
  }
  if (!document.body.trim() && document.description) {
    document.body = document.description
  }
}
