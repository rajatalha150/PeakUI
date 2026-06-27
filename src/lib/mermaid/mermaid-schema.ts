export interface MermaidDocumentInput {
  title: string
  filename?: string
  description?: string
  diagram: string
  format?: 'svg' | 'png'
  theme?: 'default' | 'dark' | 'forest' | 'neutral'
  backgroundColor?: string
}

export interface NormalizedMermaidDocument {
  title: string
  filename?: string
  description?: string
  diagram: string
  format: 'svg' | 'png'
  theme: 'default' | 'dark' | 'forest' | 'neutral'
  backgroundColor: string
}

function cleanString(value: unknown, maxLength = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

const THEMES = new Set(['default', 'dark', 'forest', 'neutral'] as const)

export function normalizeMermaidDocumentInput(input: MermaidDocumentInput): NormalizedMermaidDocument {
  return {
    title: (typeof input.title === 'string' ? input.title.trim() : '').slice(0, 200) || 'Diagram',
    filename: cleanString(input.filename, 180),
    description: cleanString(input.description, 800),
    diagram: typeof input.diagram === 'string' ? input.diagram.trim().slice(0, 60_000) : '',
    format: input.format === 'png' ? 'png' : 'svg',
    theme: input.theme && THEMES.has(input.theme) ? input.theme : 'default',
    backgroundColor: cleanString(input.backgroundColor, 32) || 'FFFFFF',
  }
}

export function mermaidDocumentHasRenderableContent(document: NormalizedMermaidDocument): boolean {
  return document.diagram.length > 0
}
