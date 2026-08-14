export interface MarkdownDocumentInput {
  title: string
  filename?: string
  description?: string
  /** Full markdown body. */
  content: string
}

export interface NormalizedMarkdownDocument {
  title: string
  filename?: string
  description?: string
  content: string
}

const MAX_MARKDOWN_CHARS = 500_000

export function normalizeMarkdownDocumentInput(input: MarkdownDocumentInput): NormalizedMarkdownDocument {
  const title = typeof input.title === 'string' && input.title.trim()
    ? input.title.trim().slice(0, 160)
    : 'Generated Markdown'

  const content = typeof input.content === 'string' && input.content.trim()
    ? input.content.trim().slice(0, MAX_MARKDOWN_CHARS)
    : ''

  return {
    title,
    filename: typeof input.filename === 'string' && input.filename.trim()
      ? input.filename.trim().slice(0, 180)
      : undefined,
    description: typeof input.description === 'string' && input.description.trim()
      ? input.description.trim().slice(0, 400)
      : undefined,
    content,
  }
}

export function markdownDocumentHasRenderableContent(document: NormalizedMarkdownDocument): boolean {
  return document.content.trim().length > 0
}

/**
 * Ensures a markdown document has renderable content. The full structure is a
 * strong recommendation, not a requirement: a title alone (optionally with a
 * description) is enough to generate a valid .md file. Falls back to the
 * description as the body, then to a title heading.
 */
export function ensureMarkdownRenderableContent(document: NormalizedMarkdownDocument): void {
  if (markdownDocumentHasRenderableContent(document)) return
  if (document.description) {
    document.content = document.description
  } else {
    document.content = `# ${document.title}`
  }
}
