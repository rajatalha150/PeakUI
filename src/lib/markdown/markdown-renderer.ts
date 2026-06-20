import type { NormalizedMarkdownDocument } from './markdown-schema'

export function renderMarkdownDocument(input: NormalizedMarkdownDocument): Buffer {
  return Buffer.from(input.content, 'utf8')
}
