import {
  OPENCLAW_PDF_DOCUMENT_TOOL_EXAMPLE,
  OPENCLAW_TAX_RETURN_TOOL_EXAMPLE,
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
      'PDF DOCUMENT CAPABILITY: When the user asks you to create, generate, produce, or return a downloadable PDF, use the pdf_document tool. Do not use shell, filesystem, or code sandbox to generate PDFs unless the user specifically asks to write source code.',
      'The pdf_document tool accepts either markdown-like content or structured sections, fields, tables, and callouts, then creates a polished server-generated PDF Canvas artifact and chat download URL.',
      'PROFESSIONAL DOCUMENT RULE: Treat PDFs as designed documents, not markdown transcripts. Prefer structured sections, fields, tables, and callouts over putting everything into one markdown string.',
      'For invoices, receipts, estimates, contracts, resumes, letters, reports, checklists, and forms: put metadata and label/value facts in fields, line items in tables, warnings/notes in callouts, and only short narrative prose in section body.',
      'Avoid markdown tables, horizontal rules, decorative markdown, and long copied summaries inside section body. Do not duplicate the same facts in both body text and tables.',
      'After a PDF tool succeeds, keep the user-facing answer download-first and concise. Do not restate the whole document in markdown unless the user asks for an inline summary.',
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
      'TAX PDF CAPABILITY: When the user has enabled a Knowledge Base folder containing tax documents and asks for a downloadable tax return PDF, use the tax_return tool.',
      'The tax_return tool extracts a structured tax packet from ready Knowledge Base documents, saves a server-generated PDF artifact, and returns a download URL for chat.',
      'Use generate_review_pdf to create a review packet from W-2/1099/supporting documents. Use fill_pdf_form only when the user identifies a fillable PDF template document id from Knowledge Base.',
      'This workflow creates a review draft with source citations and missing-field warnings. Do not claim it is officially filed, e-filed, or tax-advice complete.',
    ],
    example: OPENCLAW_TAX_RETURN_TOOL_EXAMPLE,
  },
  {
    id: 'mcp-skill-inventory',
    label: 'MCP skill inventory',
    adapter: 'mcp',
    future: true,
    promptLines: [
      'FUTURE MCP SKILL INVENTORY: PeakUI will use curated MCP adapters to help the AI discover and learn new day-to-day skills such as document conversion, template rendering, PDF manipulation, spreadsheets, and business workflows.',
      'Until MCP adapters are explicitly enabled and approved, use native PeakUI tools only. Do not claim access to external MCP servers.',
    ],
  },
]

export function listActiveCapabilityLabels(options: { workspaceAvailable: boolean }): string[] {
  return OPENCLAW_CAPABILITIES
    .filter(capability => !capability.future)
    .filter(capability => !capability.requiresWorkspace || options.workspaceAvailable)
    .map(capability => capability.label)
}

export function buildCapabilityPromptLines(options: { workspaceAvailable: boolean; includeFuture?: boolean }): string[] {
  const lines: string[] = []
  for (const capability of OPENCLAW_CAPABILITIES) {
    if (capability.future && !options.includeFuture) continue
    if (capability.requiresWorkspace && !options.workspaceAvailable) continue
    lines.push(...capability.promptLines)
    if (capability.example) {
      lines.push(`Use this exact format:\n${capability.example}`)
    }
  }
  return lines
}
