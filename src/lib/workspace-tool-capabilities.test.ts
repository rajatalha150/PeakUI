import { describe, expect, it } from 'vitest'
import { buildCapabilityPromptLines, listActiveCapabilityLabels, selectCapabilityIdsForQuery } from './workspace-tool-capabilities'

describe('workspace-tool-capabilities', () => {
  describe('listActiveCapabilityLabels', () => {
    it('excludes future capabilities', () => {
      const labels = listActiveCapabilityLabels({ workspaceAvailable: true })
      expect(labels).not.toContain('MCP skill inventory')
      expect(labels).toContain('PDF generation')
    })

    it('excludes workspace-only capabilities when no workspace is selected', () => {
      const labels = listActiveCapabilityLabels({ workspaceAvailable: false })
      expect(labels).not.toContain('tax PDF generation')
      expect(labels).toContain('PDF generation')
    })
  })

  describe('buildCapabilityPromptLines', () => {
    it('includes all enabled capabilities by default', () => {
      const lines = buildCapabilityPromptLines({ workspaceAvailable: true })
      const text = lines.join('\n')
      expect(text).toContain('PDF DOCUMENT CAPABILITY')
      expect(text).toContain('WORD DOCUMENT CAPABILITY')
      expect(text).toContain('EXCEL WORKBOOK CAPABILITY')
      expect(text).not.toContain('MCP SKILL INVENTORY')
    })

    it('can filter to specific capability ids', () => {
      const lines = buildCapabilityPromptLines({
        workspaceAvailable: true,
        includeIds: new Set(['pdf-document']),
      })
      const text = lines.join('\n')
      expect(text).toContain('PDF DOCUMENT CAPABILITY')
      expect(text).not.toContain('WORD DOCUMENT CAPABILITY')
      expect(text).not.toContain('EXCEL WORKBOOK CAPABILITY')
    })

    it('excludes future capabilities by default', () => {
      const lines = buildCapabilityPromptLines({ workspaceAvailable: true })
      expect(lines.join('\n')).not.toContain('MCP')
    })
  })

  describe('selectCapabilityIdsForQuery', () => {
    it('returns empty set when no workspace is available', () => {
      const ids = selectCapabilityIdsForQuery('create a pdf', false)
      expect(ids?.size).toBe(0)
    })

    it('matches document keywords', () => {
      expect(selectCapabilityIdsForQuery('make a pdf report', true)).toContain('pdf-document')
      expect(selectCapabilityIdsForQuery('export to excel', true)).toContain('workbook-document')
      expect(selectCapabilityIdsForQuery('write a proposal docx', true)).toContain('word-document')
      expect(selectCapabilityIdsForQuery('prepare my 1099 tax return', true)).toContain('tax-return-pdf')
    })

    it('returns empty set for unrelated queries', () => {
      const ids = selectCapabilityIdsForQuery('hello, how are you?', true)
      expect(ids?.size).toBe(0)
    })
  })
})
