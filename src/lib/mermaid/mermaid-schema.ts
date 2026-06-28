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
  // Accept common aliases for `diagram` so a model that used a different
  // natural name (code, source, mermaid, syntax) still renders.
  const record = input as unknown as Record<string, unknown>
  const diagramRaw = (typeof input.diagram === 'string' && input.diagram)
    || (typeof record.code === 'string' && record.code)
    || (typeof record.source === 'string' && record.source)
    || (typeof record.mermaid === 'string' && record.mermaid)
    || (typeof record.syntax === 'string' && record.syntax)
    || ''
  return {
    title: (typeof input.title === 'string' ? input.title.trim() : '').slice(0, 200) || 'Diagram',
    filename: cleanString(input.filename, 180),
    description: cleanString(input.description, 800),
    diagram: typeof diagramRaw === 'string' ? diagramRaw.trim().slice(0, 60_000) : '',
    format: input.format === 'png' ? 'png' : 'svg',
    theme: input.theme && THEMES.has(input.theme) ? input.theme : 'default',
    backgroundColor: cleanString(input.backgroundColor, 32) || 'FFFFFF',
  }
}

export function mermaidDocumentHasRenderableContent(document: NormalizedMermaidDocument): boolean {
  return document.diagram.length > 0
}
