import { describe, expect, it } from 'vitest'
import { extractOpenClawToolRequest, stripAllToolTags } from './openclaw-tools'

describe('openclaw tool parsing', () => {
  it('parses the first valid unified browser request from a legacy tag with concatenated JSON', () => {
    const input = [
      'Search now.',
      '<unified_browser>',
      '{"action":"search","query":"dark web palantir","browserMode":"stealth","providerId":"ahmia"}',
      '{"action":"search","query":"pltr market cap","browserMode":"direct"}',
      '</unified_browser>',
      'After that, summarize.',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('unified_browser')
    expect(extracted.request && extracted.request.name === 'unified_browser'
      ? extracted.request.request.providerId
      : undefined).toBe('ahmia')
    expect(extracted.cleanedContent).toContain('Search now.')
    expect(extracted.cleanedContent).toContain('After that, summarize.')
  })

  it('strips both modern and legacy browser tool tags from content', () => {
    const modern = '<openclaw_tool name="unified_browser">{"action":"search","query":"x"}</openclaw_tool>'
    const legacy = '<unified_browser>{"action":"search","query":"y"}</unified_browser>'
    expect(stripAllToolTags(`Before\n${modern}\nAfter`)).toBe('Before\n\nAfter')
    expect(stripAllToolTags(`Before\n${legacy}\nAfter`)).toBe('Before\n\nAfter')
  })

  it('parses structured pdf_document requests without markdown content', () => {
    const input = [
      '<openclaw_tool name="pdf_document">',
      JSON.stringify({
        title: 'Project Report',
        filename: 'project-report.pdf',
        template: 'report',
        sections: [{ heading: 'Summary', body: 'A structured report.' }],
        tables: [{ title: 'Budget', columns: ['Item', 'Amount'], rows: [{ Item: 'Hosting', Amount: '$299' }] }],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('pdf_document')
    if (extracted.request?.name !== 'pdf_document') throw new Error('Expected pdf_document request')
    expect(extracted.request.request.content).toBeUndefined()
    expect(extracted.request.request.template).toBe('report')
    expect(extracted.request.request.sections?.[0]?.heading).toBe('Summary')
    expect(extracted.request.request.tables?.[0]?.columns).toEqual(['Item', 'Amount'])
  })

  it('parses structured workbook_document requests', () => {
    const input = [
      '<openclaw_tool name="workbook_document">',
      JSON.stringify({
        title: 'Project Budget',
        filename: 'project-budget.xlsx',
        template: 'budget',
        sheets: [{
          name: 'Budget',
          columns: [
            { header: 'Category', type: 'text' },
            { header: 'Amount', type: 'currency' },
          ],
          rows: [{ Category: 'Hosting', Amount: 299 }],
        }],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('workbook_document')
    if (extracted.request?.name !== 'workbook_document') throw new Error('Expected workbook_document request')
    expect(extracted.request.request.template).toBe('budget')
    expect(extracted.request.request.sheets?.[0]?.name).toBe('Budget')
    expect(extracted.request.request.sheets?.[0]?.rows?.[0]).toEqual({ Category: 'Hosting', Amount: 299 })
  })

  it('parses structured word_document requests', () => {
    const input = [
      '<openclaw_tool name="word_document">',
      JSON.stringify({
        title: 'Services Proposal',
        filename: 'services-proposal.docx',
        template: 'proposal',
        sections: [{
          heading: 'Summary',
          body: 'A structured proposal.',
          bullets: ['Scope', 'Timeline'],
        }],
        tables: [{ title: 'Pricing', columns: ['Item', 'Amount'], rows: [{ Item: 'Implementation', Amount: '$4,500' }] }],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('word_document')
    if (extracted.request?.name !== 'word_document') throw new Error('Expected word_document request')
    expect(extracted.request.request.template).toBe('proposal')
    expect(extracted.request.request.sections?.[0]?.heading).toBe('Summary')
    expect(extracted.request.request.tables?.[0]?.columns).toEqual(['Item', 'Amount'])
  })

  it('drops invalid template values for workbook_document', () => {
    const input = [
      '<openclaw_tool name="workbook_document">',
      JSON.stringify({
        title: 'Test',
        filename: 't.xlsx',
        template: 'not-a-real-template',
        sheets: [{ name: 'Sheet1', columns: [{ header: 'A', type: 'text' }], rows: [{ A: 'x' }] }],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('workbook_document')
    if (extracted.request?.name !== 'workbook_document') throw new Error('Expected workbook_document request')
    expect(extracted.request.request.template).toBeUndefined()
  })

  it('accepts all valid workbook template values', () => {
    const validTemplates = ['workbook', 'report', 'invoice', 'budget', 'timesheet', 'ledger', 'inventory', 'schedule', 'tracker']
    for (const template of validTemplates) {
      const input = [
        '<openclaw_tool name="workbook_document">',
        JSON.stringify({
          title: 'Test',
          filename: 't.xlsx',
          template,
          sheets: [{ name: 'Sheet1', columns: [{ header: 'A', type: 'text' }], rows: [{ A: 'x' }] }],
        }),
        '</openclaw_tool>',
      ].join('\n')

      const extracted = extractOpenClawToolRequest(input)
      expect(extracted.request?.name).toBe('workbook_document')
      if (extracted.request?.name !== 'workbook_document') throw new Error('Expected workbook_document request')
      expect(extracted.request.request.template).toBe(template)
    }
  })

  it('drops malformed archive_document entries missing name or content', () => {
    const input = [
      '<openclaw_tool name="archive_document">',
      JSON.stringify({
        title: 'Bundle',
        entries: [
          { name: 'good.txt', content: 'ok' },
          { name: '', content: 'empty name' },
          { content: 'no name' },
          null,
          { name: 'no-content.txt' },
        ],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('archive_document')
    if (extracted.request?.name !== 'archive_document') throw new Error('Expected archive_document request')
    expect(extracted.request.request.entries).toHaveLength(1)
    expect((extracted.request.request.entries[0] as { name: string }).name).toBe('good.txt')
  })

  it('drops calendar_document events missing start', () => {
    const input = [
      '<openclaw_tool name="calendar_document">',
      JSON.stringify({
        title: 'Schedule',
        events: [
          { uid: 'a', start: '2026-07-01T15:00:00Z', end: '2026-07-01T16:00:00Z' },
          { uid: 'b' },
          { start: '' },
          null,
          { uid: 'c', start: '2026-07-02T10:00:00Z' },
        ],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('calendar_document')
    if (extracted.request?.name !== 'calendar_document') throw new Error('Expected calendar_document request')
    expect(extracted.request.request.events).toHaveLength(2)
    expect((extracted.request.request.events[0] as { uid?: string }).uid).toBe('a')
    expect((extracted.request.request.events[1] as { uid?: string }).uid).toBe('c')
  })

  it('rejects archive_document with no valid entries', () => {
    const input = [
      '<openclaw_tool name="archive_document">',
      JSON.stringify({
        title: 'Bundle',
        entries: [{ name: '', content: 'x' }],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('rejects calendar_document with no valid events', () => {
    const input = [
      '<openclaw_tool name="calendar_document">',
      JSON.stringify({
        title: 'Schedule',
        events: [{ uid: 'x' }],
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('parses slides_document, archive_document, calendar_document, mermaid_document tool names', () => {
    // Regression: the centralized regex previously enumerated only 16 tool
    // names and dropped these 4, which is why the Mermaid tool silently failed.
    const payloads: Record<string, string> = {
      slides_document: JSON.stringify({ title: 'Deck', slides: [{ layout: 'title', title: 'Hello' }] }),
      archive_document: JSON.stringify({ title: 'Bundle', entries: [{ name: 'a.txt', content: 'x' }] }),
      calendar_document: JSON.stringify({ title: 'Cal', events: [{ uid: 'e1', start: '2026-07-01T10:00:00Z' }] }),
      mermaid_document: JSON.stringify({ title: 'Flow', diagram: 'graph TD; A-->B' }),
    }
    for (const [name, payload] of Object.entries(payloads)) {
      const input = `<openclaw_tool name="${name}">${payload}</openclaw_tool>`
      const extracted = extractOpenClawToolRequest(input)
      expect(extracted.request?.name).toBe(name)
    }
  })

  it('accepts filesystem payloads synthesized from prose narration (stat/read/list)', () => {
    for (const action of ['stat', 'read', 'list'] as const) {
      const payload = JSON.stringify({ action, path: '/home/raza/Downloads/foo.zip' })
      const input = `<openclaw_tool name="filesystem">${payload}</openclaw_tool>`
      const extracted = extractOpenClawToolRequest(input)
      expect(extracted.request?.name).toBe('filesystem')
      const req = extracted.request?.request as { action: string; path: string }
      expect(req.action).toBe(action)
      expect(req.path).toBe('/home/raza/Downloads/foo.zip')
    }
  })
})
