import { describe, expect, it } from 'vitest'
import { normalizeMermaidDocumentInput, mermaidDocumentHasRenderableContent } from './mermaid-schema'

describe('normalizeMermaidDocumentInput', () => {
  it('accepts code as alias for diagram', () => {
    const result = normalizeMermaidDocumentInput({
      title: 'Login',
      code: 'graph TD; A-->B',
    } as never)

    expect(result.diagram).toBe('graph TD; A-->B')
    expect(mermaidDocumentHasRenderableContent(result)).toBe(true)
  })

  it('accepts source, mermaid, syntax as aliases for diagram', () => {
    for (const alias of ['source', 'mermaid', 'syntax'] as const) {
      const result = normalizeMermaidDocumentInput({
        title: 'X',
        [alias]: 'graph TD; A-->B',
      } as never)
      expect(result.diagram).toBe('graph TD; A-->B')
    }
  })
})
