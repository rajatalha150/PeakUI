import { describe, expect, it } from 'vitest'
import { detectMalformedToolWrapper, extractOpenClawToolRequest, stripAllToolTags } from './openclaw-tools'

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

  it('accepts a title-only pdf_document request (structure is recommended, not required)', () => {
    const input = [
      '<openclaw_tool name="pdf_document">',
      JSON.stringify({
        title: 'Quarterly Summary',
        description: 'A concise summary of the quarter.',
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('pdf_document')
    if (extracted.request?.name !== 'pdf_document') throw new Error('Expected pdf_document request')
    expect(extracted.request.request.title).toBe('Quarterly Summary')
    expect(extracted.request.request.description).toBe('A concise summary of the quarter.')
    expect(extracted.request.request.sections).toBeUndefined()
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

  it('accepts a title-only word_document request (structure is recommended, not required)', () => {
    const input = [
      '<openclaw_tool name="word_document">',
      JSON.stringify({
        title: 'Meeting Notes',
        description: 'Notes from the project kickoff.',
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('word_document')
    if (extracted.request?.name !== 'word_document') throw new Error('Expected word_document request')
    expect(extracted.request.request.title).toBe('Meeting Notes')
    expect(extracted.request.request.description).toBe('Notes from the project kickoff.')
    expect(extracted.request.request.sections).toBeUndefined()
  })

  it('accepts a title-only workbook_document request (structure is recommended, not required)', () => {
    const input = [
      '<openclaw_tool name="workbook_document">',
      JSON.stringify({
        title: 'Q3 Budget',
        description: 'Planned spend for the third quarter.',
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('workbook_document')
    if (extracted.request?.name !== 'workbook_document') throw new Error('Expected workbook_document request')
    expect(extracted.request.request.title).toBe('Q3 Budget')
    expect(extracted.request.request.description).toBe('Planned spend for the third quarter.')
    expect(extracted.request.request.sheets).toBeUndefined()
  })

  it('accepts a title-only csv_document request (structure is recommended, not required)', () => {
    const input = [
      '<openclaw_tool name="csv_document">',
      JSON.stringify({
        title: 'Customer List',
        description: 'Name, email, plan',
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('csv_document')
    if (extracted.request?.name !== 'csv_document') throw new Error('Expected csv_document request')
    expect(extracted.request.request.title).toBe('Customer List')
    expect(extracted.request.request.description).toBe('Name, email, plan')
    expect(extracted.request.request.content).toBeUndefined()
    expect(extracted.request.request.rows).toBeUndefined()
  })

  it('accepts a title-only email_document request (structure is recommended, not required)', () => {
    const input = [
      '<openclaw_tool name="email_document">',
      JSON.stringify({
        title: 'Follow-up',
        description: 'Checking in on the proposal.',
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('email_document')
    if (extracted.request?.name !== 'email_document') throw new Error('Expected email_document request')
    expect(extracted.request.request.title).toBe('Follow-up')
    expect(extracted.request.request.description).toBe('Checking in on the proposal.')
    expect(extracted.request.request.subject).toBe('')
    expect(extracted.request.request.body).toBe('')
  })

  it('accepts a title-only markdown_document request (structure is recommended, not required)', () => {
    const input = [
      '<openclaw_tool name="markdown_document">',
      JSON.stringify({
        title: 'Release Notes',
        description: 'What changed in v0.14.',
      }),
      '</openclaw_tool>',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('markdown_document')
    if (extracted.request?.name !== 'markdown_document') throw new Error('Expected markdown_document request')
    expect(extracted.request.request.title).toBe('Release Notes')
    expect(extracted.request.request.description).toBe('What changed in v0.14.')
    expect(extracted.request.request.content).toBe('')
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

  it('does not promote a hallucinated <unified_browser> with XML child elements to a tool extraction', () => {
    // Models occasionally emit Anthropic SDK-style tool calls
    // (`<unified_browser><parameter name="action">open</parameter>...`)
    // or function_calls wrappers. These are not legacy tool calls —
    // the body is XML, not JSON, and the parser must reject them.
    const input = [
      'Let me check the price action.',
      '<unified_browser>',
      '<parameter name="action">open</parameter>',
      '<parameter name="url">https://stockanalysis.com/stocks/pltr/</parameter>',
      '<parameter name="description">Check today\'s PLTR price action</parameter>',
      '</unified_browser>',
      'After the page loads I will report back.',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
    // The user-visible text must NOT leak the raw broken XML.
    expect(extracted.cleanedContent).not.toContain('<parameter')
    expect(extracted.cleanedContent).not.toContain('<unified_browser>')
    expect(extracted.cleanedContent).toContain('Let me check the price action.')
    expect(extracted.cleanedContent).toContain('After the page loads I will report back.')
  })

  it('strips well-known malformed tool-call formats (Anthropic SDK, Qwen, etc.) from cleaned content', () => {
    const cases: Array<{ label: string; input: string; mustNotContain: string[] }> = [
      {
        label: 'Anthropic function_calls wrapper',
        input: '<tool_call>\n<function_calls>\n<invoke name="web">\n<parameter name="query">x</parameter>\n</invoke>\n</function_calls>\nDone.',
        mustNotContain: ['<function_calls>', '<invoke', '<parameter', '<tool_call>', '</invoke>'],
      },
      {
        label: 'Qwen-style tool_call tokens',
        input: 'Hi<|tool_call|>stuff<|tool_call_end|>there<|end_of_turn|>',
        mustNotContain: ['<|tool_call|>', '<|tool_call_end|>', '<|end_of_turn|>'],
      },
      {
        label: 'antml namespace',
        input: 'Pre<antml:function_calls>oops</antml:function_calls>post',
        mustNotContain: ['<antml:function_calls>', '</antml:function_calls>'],
      },
      {
        label: 'bare orphaned closing tags',
        input: 'a</invoke>b</parameter>c</function_calls>d',
        mustNotContain: ['</invoke>', '</parameter>', '</function_calls>'],
      },
    ]
    for (const testCase of cases) {
      const cleaned = stripAllToolTags(testCase.input)
      for (const fragment of testCase.mustNotContain) {
        expect(cleaned, `${testCase.label}: should not contain ${fragment}`).not.toContain(fragment)
      }
    }
  })

  it('still parses a correctly formed modern <openclaw_tool> after stripping junk wrappers', () => {
    const input = [
      'Some prose.',
      '<function_calls>',
      '<openclaw_tool name="web">{"query":"palantir stock"}</openclaw_tool>',
      '</function_calls>',
      'More prose.',
    ].join('\n')

    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('web')
    if (extracted.request?.name !== 'web') throw new Error('Expected web request')
    expect(extracted.request.request.query).toBe('palantir stock')
    expect(extracted.cleanedContent).toContain('Some prose.')
    expect(extracted.cleanedContent).toContain('More prose.')
    expect(extracted.cleanedContent).not.toContain('<function_calls>')
  })
})

describe('template placeholder guard', () => {
  it('rejects a copied <https URL> placeholder in unified_browser open (no broken dispatch)', () => {
    const input = '<openclaw_tool name="unified_browser">{"action":"open","url":"<https URL>","description":"<what to inspect>"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('rejects a copied <https URL> placeholder in the browser tool', () => {
    const input = '<openclaw_tool name="browser">{"action":"open","url":"<https URL>"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('rejects a copied <value> placeholder for web query', () => {
    const input = '<openclaw_tool name="web">{"query":"<value>"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('rejects a copied <command to run> placeholder for shell', () => {
    const input = '<openclaw_tool name="shell">{"command":"<command to run>","description":"<what it does>"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('rejects a copied <path> placeholder for filesystem', () => {
    const input = '<openclaw_tool name="filesystem">{"action":"read","path":"<path>"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request).toBeUndefined()
  })

  it('keeps a real value that merely contains angle brackets mid-string (not a placeholder)', () => {
    const input = '<openclaw_tool name="code">{"runtime":"node","code":"const el = <App />;","description":"render"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('code')
    if (extracted.request?.name !== 'code') throw new Error('expected code')
    expect(extracted.request.request.code).toBe('const el = <App />;')
  })

  it('still accepts a real unified_browser open with a proper URL', () => {
    const input = '<openclaw_tool name="unified_browser">{"action":"open","url":"https://stockanalysis.com/stocks/pltr/"}</openclaw_tool>'
    const extracted = extractOpenClawToolRequest(input)
    expect(extracted.request?.name).toBe('unified_browser')
    if (extracted.request?.name !== 'unified_browser') throw new Error('expected ub')
    expect(extracted.request.request.url).toBe('https://stockanalysis.com/stocks/pltr/')
  })
})

describe('bare-domain URL promotion from prose', () => {
  it('promotes a bare domain in "open <domain>" narration (no scheme)', () => {
    const extracted = extractOpenClawToolRequest('I\'ll open stockanalysis.com for the PLTR forecast.')
    expect(extracted.request?.name).toBe('unified_browser')
    if (extracted.request?.name !== 'unified_browser') throw new Error('expected ub')
    expect(extracted.request.request.action).toBe('open')
    expect(extracted.request.request.url).toBe('https://stockanalysis.com')
  })

  it('promotes a bare domain with a path', () => {
    const extracted = extractOpenClawToolRequest('Now open marketbeat.com/stocks/NASDAQ/PLTR/forecast/')
    expect(extracted.request?.name).toBe('unified_browser')
    if (extracted.request?.name !== 'unified_browser') throw new Error('expected ub')
    expect(extracted.request.request.url).toBe('https://marketbeat.com/stocks/NASDAQ/PLTR/forecast/')
  })

  it('still recovers a full https URL from prose', () => {
    const extracted = extractOpenClawToolRequest('Let me visit https://example.org/page to check the listing.')
    expect(extracted.request?.name).toBe('unified_browser')
    if (extracted.request?.name !== 'unified_browser') throw new Error('expected ub')
    expect(extracted.request.request.url).toBe('https://example.org/page')
  })

  it('does not promote a non-domain token', () => {
    const extracted = extractOpenClawToolRequest('Let me check the latest numbers now.')
    expect(extracted.request).toBeUndefined()
  })
})

describe('"Search query:" longhand recovery from prose', () => {
  it('recovers a unified_browser search from "Search query: X" narration', () => {
    const extracted = extractOpenClawToolRequest(
      'Need try different sources. We can use unified_browser with multiple opens across tabs or search. Search query: GameStop GME analyst price target current 2026 how many analysts cover.',
    )
    expect(extracted.request?.name).toBe('unified_browser')
    if (extracted.request?.name !== 'unified_browser') throw new Error('expected ub search')
    expect((extracted.request.request as { action: string }).action).toBe('search')
    expect((extracted.request.request as { query: string }).query).toBe(
      'GameStop GME analyst price target current 2026 how many analysts cover',
    )
  })

  it('trims trailing punctuation from the query', () => {
    const extracted = extractOpenClawToolRequest('Search query: PLTR price target consensus.')
    expect(extracted.request?.name).toBe('unified_browser')
    expect((extracted.request?.request as { query?: string }).query).toBe('PLTR price target consensus')
  })

  it('accepts an equals sign and quoted query', () => {
    const extracted = extractOpenClawToolRequest('Search query="NVDA analyst ratings July 2026"')
    expect(extracted.request?.name).toBe('unified_browser')
    expect((extracted.request?.request as { query?: string }).query).toBe('NVDA analyst ratings July 2026')
  })

  it('does not fire on ordinary prose that merely contains the word "search"', () => {
    const extracted = extractOpenClawToolRequest('I will run a search for that next.')
    expect(extracted.request).toBeUndefined()
  })
})

describe('detectMalformedToolWrapper', () => {
  it('detects Anthropic function_calls wrapper', () => {
    expect(detectMalformedToolWrapper('Sure.<function_calls><invoke name="web"><parameter name="query">x</parameter></invoke></function_calls>')).toBe('function_calls')
  })

  it('detects antml namespaced wrapper', () => {
    expect(detectMalformedToolWrapper('Pre<antml:function_calls>oops</antml:function_calls>post')).toBe('antml')
  })

  it('detects bare invoke/parameter convention', () => {
    expect(detectMalformedToolWrapper('<invoke name="web"><parameter name="query">x</parameter></invoke>')).toBe('invoke')
  })

  it('detects Qwen-style special tokens', () => {
    expect(detectMalformedToolWrapper('Hi<|tool_call|>stuff<|end_of_turn|>')).toBe('qwen_tokens')
  })

  it('detects tool_use wrapper', () => {
    expect(detectMalformedToolWrapper('<tool_use>{"name":"web"}</tool_use>')).toBe('tool_use')
  })

  it('returns null for a correct openclaw_tool block', () => {
    expect(detectMalformedToolWrapper('<openclaw_tool name="web">{"query":"x"}</openclaw_tool>')).toBeNull()
  })

  it('returns null for plain prose with no wrapper', () => {
    expect(detectMalformedToolWrapper('Here is the answer to your question.')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(detectMalformedToolWrapper('')).toBeNull()
  })
})
