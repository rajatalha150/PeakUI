export type WorkspaceToolCapabilityAdapter = 'native' | 'http' | 'mcp'

export interface WorkspaceToolCapability {
  id: string
  label: string
  adapter: WorkspaceToolCapabilityAdapter
  toolName?: string
  promptLines: string[]
  /** Compact one-line JSON signature for the always-on tool manifest. */
  signature?: string
  requiresWorkspace?: boolean
  future?: boolean
}

export const WORKSPACE_TOOL_CAPABILITIES: WorkspaceToolCapability[] = [
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
    signature: 'pdf_document {"title":"...","content":"...","sections":[{"heading":"...","body":"..."}],"tables":[{"title":"...","columns":["..."],"rows":[{...}]}]}',
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
    signature: 'tax_return {"action":"generate_review_pdf"|"fill_pdf_form"|"list_forms"|"inspect_form","taxYear":"2025","formId":"f1040","fields":{...}}',
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
    signature: 'workbook_document {"title":"...","sheets":[{"name":"...","columns":[{"header":"...","type":"text|number|currency|date"}],"rows":[{...}]}]}',
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
    signature: 'fetch_summarize {"url":"https://..."}',
  },
  {
    id: 'notes-recall',
    label: 'Saved notes (cross-session memory)',
    adapter: 'native',
    toolName: 'notes_search',
    promptLines: [
      'SAVED NOTES CAPABILITY: You can search notes you saved in previous sessions with notes_search, and store durable facts with notes_save.',
      'Use notes_search when the user references past work ("as we discussed", "the thing I asked for last week") or when prior context would clearly help. Use notes_save when the user asks you to remember something, states a durable preference, or makes a decision worth carrying forward.',
      'Notes are per-user and persist across sessions. Do not guess at past context — search for it.',
    ],
    signature: 'notes_search {"query":"..."} | notes_save {"title":"...","content":"..."}',
  },
  {
    id: 'http-request',
    label: 'HTTP API request',
    adapter: 'native',
    toolName: 'http_request',
    promptLines: [
      'HTTP REQUEST CAPABILITY: When the user asks you to call a public API (Jira, GitHub, a REST endpoint), use the http_request tool with a method, URL, optional headers, and optional JSON body.',
      'Only public http(s) URLs are allowed; private/localhost addresses are blocked. The response body is returned as text for you to summarize.',
    ],
    signature: 'http_request {"method":"GET|POST|PUT|PATCH|DELETE","url":"https://...","headers":{...},"body":{...}}',
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
  return WORKSPACE_TOOL_CAPABILITIES
    .filter(capability => !capability.future)
    .filter(capability => !capability.requiresWorkspace || options.workspaceAvailable)
    .map(capability => capability.label)
}

/**
 * Compact one-line JSON signatures for the built-in tools that live in
 * `WORKSPACE_TOOL_CAPABILITIES`. Emitted as part of the always-on tool manifest so
 * small local models (whose verbose tutorials are trimmed to fit the context
 * window) still know the exact tool name and field names instead of only the
 * human label.
 */
export function listCapabilitySignatures(options: { workspaceAvailable: boolean }): string[] {
  return WORKSPACE_TOOL_CAPABILITIES
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
  for (const capability of WORKSPACE_TOOL_CAPABILITIES) {
    if (capability.future && !options.includeFuture) continue
    if (capability.requiresWorkspace && !options.workspaceAvailable) continue
    if (includeIds && !includeIds.has(capability.id)) continue
    lines.push(...capability.promptLines)
    if (capability.signature && capability.toolName) {
      // The signature is `toolName {json}`; strip the leading tool name so the
      // JSON payload sits cleanly inside the wrapper without duplicating it.
      const json = capability.signature.slice(capability.toolName.length).trim()
      lines.push(`Use this exact format:\n<workspace_tool name="${capability.toolName}">${json}</workspace_tool>`)
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
