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
