import {
  OPENCLAW_PDF_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_TAX_RETURN_TOOL_EXAMPLE,
  OPENCLAW_WORKBOOK_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_WORD_DOCUMENT_TOOL_EXAMPLE,
} from './openclaw-tools'

export type OpenClawCapabilityAdapter = 'native' | 'http' | 'mcp'

export interface OpenClawCapability {
  id: string
  label: string
  adapter: OpenClawCapabilityAdapter
  toolName?: string
  promptLines: string[]
  example?: string
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
      'Prefer structured sections, fields, tables, and callouts over long markdown body text.',
    ],
    example: OPENCLAW_PDF_DOCUMENT_TOOL_EXAMPLE,
  },
  {
    id: 'tax-return-pdf',
    label: 'tax PDF generation',
    adapter: 'native',
    toolName: 'tax_return',
    requiresWorkspace: true,
    promptLines: [
      'TAX PDF CAPABILITY: When the user has enabled a Knowledge Base tax folder and asks for a downloadable tax return PDF, use the tax_return tool.',
      'Use generate_review_pdf for W-2/1099 review packets; use fill_pdf_form only when a fillable PDF template id is provided.',
    ],
    example: OPENCLAW_TAX_RETURN_TOOL_EXAMPLE,
  },
  {
    id: 'workbook-document',
    label: 'Excel workbook generation',
    adapter: 'native',
    toolName: 'workbook_document',
    promptLines: [
      'EXCEL WORKBOOK CAPABILITY: When the user asks for a downloadable spreadsheet, use the workbook_document tool.',
      'Use sheets, typed columns, and totals for structured data; keep the chat response download-first after the tool succeeds.',
    ],
    example: OPENCLAW_WORKBOOK_DOCUMENT_TOOL_EXAMPLE,
  },
  {
    id: 'word-document',
    label: 'Word document generation',
    adapter: 'native',
    toolName: 'word_document',
    promptLines: [
      'WORD DOCUMENT CAPABILITY: When the user asks for a downloadable Word document, use the word_document tool.',
      'Use fields for metadata, sections for prose, tables for structured comparisons, and callouts for notes or next steps.',
    ],
    example: OPENCLAW_WORD_DOCUMENT_TOOL_EXAMPLE,
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
    keywords: ['excel', 'spreadsheet', 'workbook', 'xlsx', 'csv', 'sheet'],
  },
  {
    id: 'word-document',
    keywords: ['word', 'docx', 'proposal', 'contract', 'resume'],
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
