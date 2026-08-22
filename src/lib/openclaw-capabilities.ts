import {
  OPENCLAW_CSV_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_EMAIL_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_FETCH_SUMMARIZE_TOOL_EXAMPLE,
  OPENCLAW_MARKDOWN_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_PDF_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_TAX_RETURN_TOOL_EXAMPLE,
  OPENCLAW_WORKBOOK_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_WORD_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_SLIDES_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_ARCHIVE_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_CALENDAR_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_MERMAID_DOCUMENT_TOOL_EXAMPLE,
} from './openclaw-tools'

export type OpenClawCapabilityAdapter = 'native' | 'http' | 'mcp'

export interface OpenClawCapability {
  id: string
  label: string
  adapter: OpenClawCapabilityAdapter
  toolName?: string
  promptLines: string[]
  example?: string
  /** Compact one-line JSON signature for the always-on tool manifest. */
  signature?: string
  requiresWorkspace?: boolean
  future?: boolean
}

export const OPENCLAW_CAPABILITIES: OpenClawCapability[] = [
  {
    id: 'pdf-document',
    label: 'PDF generation',
    adapter: 'native',
    toolName: 'pdf_document',
    promptLines: [
      'PDF DOCUMENT CAPABILITY: When the user asks for a downloadable PDF, use the pdf_document tool.',
      'The full structure is recommended but not required: a title with a simple content string (or just a title and description) is sufficient.',
      'For the most beautiful result, model the document with sections, fields, tables, and callouts — each element is styled with color, spacing, and layout, so structured documents render as polished, professional PDFs.',
    ],
    example: OPENCLAW_PDF_DOCUMENT_TOOL_EXAMPLE,
    signature: 'pdf_document {"title":"...","content":"..."}',
  },
  {
    id: 'tax-return-pdf',
    label: 'tax PDF generation',
    adapter: 'native',
    toolName: 'tax_return',
    requiresWorkspace: true,
    promptLines: [
      'TAX PDF CAPABILITY: When the user asks for a tax return or an official IRS form, use the tax_return tool.',
      'Use list_forms to see available IRS forms; inspect_form with a formId to see a form\'s fillable fields before filling.',
      'Use fill_pdf_form with a formId (e.g. "f1040") to fill an official IRS form, or with templateDocumentId for an uploaded template; pass derived client values in fields. Use generate_review_pdf for W-2/1099 review packets.',
    ],
    example: OPENCLAW_TAX_RETURN_TOOL_EXAMPLE,
    signature: 'tax_return {"action":"generate_review_pdf"|"fill_pdf_form"|"list_forms"|"inspect_form","taxYear":"2025","formId":"f1040"}',
  },
  {
    id: 'workbook-document',
    label: 'Excel workbook generation',
    adapter: 'native',
    toolName: 'workbook_document',
    promptLines: [
      'EXCEL WORKBOOK CAPABILITY: When the user asks for a downloadable spreadsheet, use the workbook_document tool.',
      'Use sheets, typed columns, and totals for structured data; keep the chat response download-first after the tool succeeds.',
      'The full structure is recommended but not required: a title with a description (or just a title) is sufficient — a Notes sheet is generated automatically.',
    ],
    example: OPENCLAW_WORKBOOK_DOCUMENT_TOOL_EXAMPLE,
    signature: 'workbook_document {"title":"...","sheets":[{"name":"...","columns":[{"header":"..."}],"rows":[{...}]}]}',
  },
  {
    id: 'word-document',
    label: 'Word document generation',
    adapter: 'native',
    toolName: 'word_document',
    promptLines: [
      'WORD DOCUMENT CAPABILITY: When the user asks for a downloadable Word document, use the word_document tool.',
      'Use fields for metadata, sections for prose, tables for structured comparisons, and callouts for notes or next steps.',
      'The full structure is recommended but not required: a title with a simple content string (or just a title and description) is sufficient.',
    ],
    example: OPENCLAW_WORD_DOCUMENT_TOOL_EXAMPLE,
    signature: 'word_document {"title":"...","content":"...","sections":[{"heading":"...","body":"..."}]}',
  },
  {
    id: 'csv-document',
    label: 'CSV export',
    adapter: 'native',
    toolName: 'csv_document',
    promptLines: [
      'CSV EXPORT CAPABILITY: When the user asks for a downloadable CSV spreadsheet, table data export, or structured data in CSV format, use the csv_document tool.',
      'Provide headers and rows, or raw CSV content. The result is a downloadable .csv artifact.',
      'The full structure is recommended but not required: a title with a description (or just a title) is sufficient — the description becomes the body.',
    ],
    example: OPENCLAW_CSV_DOCUMENT_TOOL_EXAMPLE,
    signature: 'csv_document {"title":"...","headers":["..."],"rows":[{...}]}',
  },
  {
    id: 'email-document',
    label: 'Email writer',
    adapter: 'native',
    toolName: 'email_document',
    promptLines: [
      'EMAIL WRITER CAPABILITY: When the user asks to draft, write, or generate an email message, use the email_document tool.',
      'Include to, from, subject, and a professional plain-text body. The result is a downloadable .eml file that opens in any email client.',
      'The full structure is recommended but not required: a title with a description (or just a title) is sufficient — the subject and body are derived automatically.',
    ],
    example: OPENCLAW_EMAIL_DOCUMENT_TOOL_EXAMPLE,
    signature: 'email_document {"title":"...","to":"...","subject":"...","body":"..."}',
  },
  {
    id: 'markdown-document',
    label: 'Markdown document generation',
    adapter: 'native',
    toolName: 'markdown_document',
    promptLines: [
      'MARKDOWN DOCUMENT CAPABILITY: When the user asks for a downloadable Markdown file (.md), a markdown version of a document, or a markdown export, use the markdown_document tool.',
      'Provide the full markdown body in the content field. The result is a downloadable .md Canvas artifact with a clickable /api/canvas/artifacts/<id>/download link. Do NOT write markdown files to the filesystem as a workaround.',
      'The full structure is recommended but not required: a title with a description (or just a title) is sufficient — the description becomes the body, or a title heading is used.',
    ],
    example: OPENCLAW_MARKDOWN_DOCUMENT_TOOL_EXAMPLE,
    signature: 'markdown_document {"title":"...","content":"..."}',
  },
  {
    id: 'slides-document',
    label: 'Slide deck generation',
    adapter: 'native',
    toolName: 'slides_document',
    promptLines: [
      'SLIDE DECK CAPABILITY: When the user asks for a slide deck, PowerPoint, or .pptx file, use the slides_document tool.',
      'Provide a title and an array of slides with explicit layouts (title, section, content, bullets, two-column, quote, closing). The result is a downloadable .pptx artifact.',
    ],
    example: OPENCLAW_SLIDES_DOCUMENT_TOOL_EXAMPLE,
    signature: 'slides_document {"title":"...","slides":[{"layout":"title|bullets|two-column|closing","title":"...","bullets":["..."]}]}',
  },
  {
    id: 'archive-document',
    label: 'Archive (ZIP) bundle',
    adapter: 'native',
    toolName: 'archive_document',
    promptLines: [
      'ARCHIVE CAPABILITY: When the user asks to bundle, zip, or package multiple files together, use the archive_document tool.',
      'Provide a list of entries (filename, mimeType, content). The result is a downloadable .zip artifact.',
    ],
    example: OPENCLAW_ARCHIVE_DOCUMENT_TOOL_EXAMPLE,
    signature: 'archive_document {"title":"...","entries":[{"name":"file.txt","mimeType":"text/plain","content":"..."}]}',
  },
  {
    id: 'calendar-document',
    label: 'ICS calendar event',
    adapter: 'native',
    toolName: 'calendar_document',
    promptLines: [
      'CALENDAR CAPABILITY: When the user asks to schedule a meeting, create an event, or produce an .ics file, use the calendar_document tool.',
      'Provide one or more events with title, start, end, and optional location/attendees. The result is a downloadable .ics artifact.',
    ],
    example: OPENCLAW_CALENDAR_DOCUMENT_TOOL_EXAMPLE,
    signature: 'calendar_document {"title":"...","events":[{"title":"...","start":"...","end":"..."}]}',
  },
  {
    id: 'mermaid-document',
    label: 'Mermaid diagram',
    adapter: 'native',
    toolName: 'mermaid_document',
    promptLines: [
      'MERMAID CAPABILITY: When the user asks for a flowchart, sequence diagram, ER diagram, or other Mermaid-rendered visualization, use the mermaid_document tool.',
      'Provide the Mermaid source in the diagram field. The result is a downloadable .svg (or .png) artifact that renders inline in Canvas.',
    ],
    example: OPENCLAW_MERMAID_DOCUMENT_TOOL_EXAMPLE,
    signature: 'mermaid_document {"title":"...","diagram":"graph TD; A-->B","format":"svg|png"}',
  },
  {
    id: 'fetch-summarize',
    label: 'URL fetch and summarize',
    adapter: 'native',
    toolName: 'fetch_summarize',
    promptLines: [
      'URL SUMMARIZE CAPABILITY: When the user provides a single public URL and asks to fetch, summarize, or extract the key points, use the fetch_summarize tool.',
      'The result will include a title, 3-5 bullet summary, key quote, and source URL.',
    ],
    example: OPENCLAW_FETCH_SUMMARIZE_TOOL_EXAMPLE,
    signature: 'fetch_summarize {"url":"https://..."}',
  },
  {
    id: 'stealth-search',
    label: 'Stealth web search (Tor)',
    adapter: 'native',
    toolName: 'unified_browser',
    promptLines: [
      'STEALTH SEARCH CAPABILITY: When the user asks to search the dark web, onion sites, Tor index, or use a privacy-preserving search, use the unified_browser tool with browserMode "stealth".',
      'Set action to "search", provide the query, and set browserMode to "stealth". Results may include .onion links.',
    ],
    example: `<openclaw_tool name="unified_browser">\n{"action":"search","query":"privacy focused search engines","browserMode":"stealth","description":"Search via Tor"}\n</openclaw_tool>`,
    signature: 'unified_browser {"action":"search","query":"...","browserMode":"stealth"}',
  },
  {
    id: 'mcp-skill-inventory',
    label: 'MCP skill inventory',
    adapter: 'mcp',
    future: true,
    promptLines: [
      'FUTURE MCP SKILL INVENTORY: PeakUI will use curated MCP adapters for additional skills. Until explicitly enabled, use native PeakUI tools only.',
    ],
  },
]

export function listActiveCapabilityLabels(options: { workspaceAvailable: boolean }): string[] {
  return OPENCLAW_CAPABILITIES
    .filter(capability => !capability.future)
    .filter(capability => !capability.requiresWorkspace || options.workspaceAvailable)
    .map(capability => capability.label)
}

/**
 * Compact one-line JSON signatures for the built-in tools that live in
 * `OPENCLAW_CAPABILITIES`. Emitted as part of the always-on tool manifest so
 * small local models (whose verbose tutorials are trimmed to fit the context
 * window) still know the exact tool name and field names instead of only the
 * human label.
 */
export function listCapabilitySignatures(options: { workspaceAvailable: boolean }): string[] {
  return OPENCLAW_CAPABILITIES
    .filter(capability => !capability.future)
    .filter(capability => !capability.requiresWorkspace || options.workspaceAvailable)
    .filter(capability => capability.signature)
    .map(capability => capability.signature as string)
}

export interface BuildCapabilityPromptOptions {
  workspaceAvailable: boolean
  includeFuture?: boolean
  /**
   * If provided, only capabilities in this set are included. This lets the
   * chat pipeline avoid sending PDF/Word/Excel tutorials on turns where the
   * user is unlikely to need them, while keeping the tool available when it
   * is explicitly relevant.
   */
  includeIds?: Set<string>
}

export function buildCapabilityPromptLines(options: BuildCapabilityPromptOptions): string[] {
  const includeIds = options.includeIds
  const lines: string[] = []
  for (const capability of OPENCLAW_CAPABILITIES) {
    if (capability.future && !options.includeFuture) continue
    if (capability.requiresWorkspace && !options.workspaceAvailable) continue
    if (includeIds && !includeIds.has(capability.id)) continue
    lines.push(...capability.promptLines)
    if (capability.example) {
      lines.push(`Use this exact format:\n${capability.example}`)
    }
  }
  return lines
}

interface CapabilityTrigger {
  id: string
  keywords: string[]
}

const CAPABILITY_KEYWORD_TRIGGERS: CapabilityTrigger[] = [
  {
    id: 'pdf-document',
    keywords: ['pdf', 'document', 'report', 'invoice', 'memo', 'letter', 'checklist', 'form'],
  },
  {
    id: 'workbook-document',
    keywords: ['excel', 'spreadsheet', 'workbook', 'xlsx', 'sheet'],
  },
  {
    id: 'word-document',
    keywords: ['word', 'docx', 'proposal', 'contract', 'resume', 'meeting notes', 'meeting minutes'],
  },
  {
    id: 'csv-document',
    keywords: ['csv', 'export table', 'export data', 'download csv'],
  },
  {
    id: 'email-document',
    keywords: ['email', 'draft email', 'write an email', 'compose email', 'message'],
  },
  {
    id: 'markdown-document',
    keywords: ['markdown', '.md', 'md file', 'markdown version', 'markdown export', 'convert to markdown'],
  },
  {
    id: 'slides-document',
    keywords: ['slide deck', 'slides', 'powerpoint', 'pptx', 'presentation', 'deck'],
  },
  {
    id: 'archive-document',
    keywords: ['zip', 'archive', 'bundle', 'package files', 'zip them up'],
  },
  {
    id: 'calendar-document',
    keywords: ['calendar event', '.ics', 'ical', 'ics file', 'schedule meeting', 'invite'],
  },
  {
    id: 'mermaid-document',
    keywords: ['mermaid', 'flowchart', 'sequence diagram', 'er diagram', 'class diagram', 'diagram'],
  },
  {
    id: 'fetch-summarize',
    keywords: ['summarize this url', 'fetch this page', 'summarize the article', 'extract from url'],
  },
  {
    id: 'stealth-search',
    keywords: ['onion', 'dark web', 'tor search', 'stealth search', '.onion'],
  },
  {
    id: 'tax-return-pdf',
    keywords: ['tax', 'w-2', 'w2', '1099', 'return', 'irs'],
  },
]

/**
 * Pick document-generation capability IDs that are relevant to the latest user
 * query. This keeps verbose JSON examples out of turns where the user is just
 * chatting or doing filesystem/shell work. The model still sees the capability
 * label in the active-tools list, so it can request the full instructions by
 * wording its next turn around the relevant document type.
 */
export function selectCapabilityIdsForQuery(
  query: string | undefined,
  workspaceAvailable: boolean,
): Set<string> | undefined {
  if (!workspaceAvailable || !query || !query.trim()) return new Set()

  const normalized = query.trim().toLowerCase()
  const matchedIds = CAPABILITY_KEYWORD_TRIGGERS
    .filter(trigger => trigger.keywords.some(keyword => normalized.includes(keyword)))
    .map(trigger => trigger.id)

  if (matchedIds.length === 0) return new Set()
  return new Set(matchedIds)
}
