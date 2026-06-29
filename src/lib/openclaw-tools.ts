import type {
  PdfDocumentCallout,
  PdfDocumentField,
  PdfDocumentSection,
  PdfDocumentTable,
  PdfDocumentTemplate,
} from './pdf/document-schema'
import type { WorkbookDocumentInput } from './workbook/workbook-schema'
import type { WordDocumentInput, WordDocumentTemplate } from './word/word-schema'
import type { CsvDocumentInput } from './csv/csv-schema'
import type { EmailDocumentInput } from './email/email-schema'
import type { MarkdownDocumentInput } from './markdown/markdown-schema'
import type { SlidesDocumentInput } from './slides/slides-schema'
import type { ArchiveDocumentInput } from './archive/archive-schema'
import type { CalendarDocumentInput } from './calendar/calendar-schema'
import type { MermaidDocumentInput } from './mermaid/mermaid-schema'

export interface OpenClawShellToolRequest {
  command: string
  description?: string
}

export interface OpenClawWebToolRequest {
  query: string
  description?: string
}

export interface OpenClawFilesystemToolRequest {
  action: 'list' | 'read' | 'stat' | 'write' | 'append' | 'mkdir'
  path: string
  content?: string
  createDirectories?: boolean
}

export interface OpenClawCodeToolRequest {
  runtime: 'python' | 'node'
  code: string
  filename?: string
  workspacePath?: string
  args?: string[]
  description?: string
}

export interface OpenClawBrowserToolRequest {
  action: 'open' | 'click' | 'fill' | 'submit' | 'extract'
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  description?: string
}

export interface OpenClawUwafBrowserToolRequest {
  action: 'search' | 'open' | 'click' | 'type' | 'press' | 'wait_for_selector' | 'scroll' | 'back' | 'forward' | 'new_tab' | 'list_tabs' | 'switch_tab' | 'close_tab' | 'select' | 'hover' | 'extract_table' | 'research_batch' | 'fill' | 'submit' | 'extract' | 'wait_for_user'
  query?: string
  providerId?: string
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  browserMode?: 'direct' | 'stealth'
  stealthProfile?: 'normal' | 'high'
  depth?: number
  selector?: string
  text?: string
  key?: string
  tabIndex?: number
  timeoutMs?: number
  deltaY?: number
  optionValue?: string
  optionLabel?: string
  description?: string
}

export interface OpenClawTaxReturnToolRequest {
  action: 'generate_review_pdf' | 'fill_pdf_form'
  folder?: string
  taxYear?: string
  templateDocumentId?: string
  flatten?: boolean
  description?: string
}

export interface OpenClawPdfDocumentToolRequest {
  title: string
  content?: string
  filename?: string
  description?: string
  template?: PdfDocumentTemplate
  subtitle?: string
  sections?: PdfDocumentSection[]
  fields?: PdfDocumentField[]
  tables?: PdfDocumentTable[]
  callouts?: PdfDocumentCallout[]
  metadata?: {
    author?: string
    subject?: string
    footer?: string
  }
}

export type OpenClawWorkbookDocumentToolRequest = WorkbookDocumentInput

export type OpenClawWordDocumentToolRequest = WordDocumentInput

export type OpenClawCsvDocumentToolRequest = CsvDocumentInput

export type OpenClawEmailDocumentToolRequest = EmailDocumentInput

export type OpenClawMarkdownDocumentToolRequest = MarkdownDocumentInput

export type OpenClawSlidesDocumentToolRequest = SlidesDocumentInput

export type OpenClawArchiveDocumentToolRequest = ArchiveDocumentInput

export type OpenClawCalendarDocumentToolRequest = CalendarDocumentInput

export type OpenClawMermaidDocumentToolRequest = MermaidDocumentInput

export interface OpenClawFetchSummarizeToolRequest {
  url: string
  description?: string
}

export type OpenClawToolRequest =
  | {
      name: 'web'
      request: OpenClawWebToolRequest
    }
  | {
      name: 'shell'
      request: OpenClawShellToolRequest
    }
  | {
      name: 'filesystem'
      request: OpenClawFilesystemToolRequest
    }
  | {
      name: 'code'
      request: OpenClawCodeToolRequest
    }
  | {
      name: 'browser'
      request: OpenClawBrowserToolRequest
    }
  | {
      name: 'unified_browser'
      request: OpenClawUwafBrowserToolRequest
    }
  | {
      name: 'tax_return'
      request: OpenClawTaxReturnToolRequest
    }
  | {
      name: 'pdf_document'
      request: OpenClawPdfDocumentToolRequest
    }
  | {
      name: 'workbook_document'
      request: OpenClawWorkbookDocumentToolRequest
    }
  | {
      name: 'word_document'
      request: OpenClawWordDocumentToolRequest
    }
  | {
      name: 'csv_document'
      request: OpenClawCsvDocumentToolRequest
    }
  | {
      name: 'email_document'
      request: OpenClawEmailDocumentToolRequest
    }
  | {
      name: 'markdown_document'
      request: OpenClawMarkdownDocumentToolRequest
    }
  | {
      name: 'slides_document'
      request: OpenClawSlidesDocumentToolRequest
    }
  | {
      name: 'archive_document'
      request: OpenClawArchiveDocumentToolRequest
    }
  | {
      name: 'calendar_document'
      request: OpenClawCalendarDocumentToolRequest
    }
  | {
      name: 'mermaid_document'
      request: OpenClawMermaidDocumentToolRequest
    }
  | {
      name: 'fetch_summarize'
      request: OpenClawFetchSummarizeToolRequest
    }

export const OPENCLAW_WEB_TOOL_EXAMPLE = `<openclaw_tool name="web">
{"query":"latest Next.js 16 route handlers docs","description":"Verify the current route-handler behavior before answering"}
</openclaw_tool>`

export const OPENCLAW_SHELL_TOOL_EXAMPLE = `<openclaw_tool name="shell">
{"command":"pwd","description":"Check the current workspace"}
</openclaw_tool>`

export const OPENCLAW_FILESYSTEM_TOOL_EXAMPLE = `<openclaw_tool name="filesystem">
{"action":"read","path":"/home/user/project/src/app.ts"}
</openclaw_tool>`

export const OPENCLAW_FILESYSTEM_WRITE_TOOL_EXAMPLE = `<openclaw_tool name="filesystem">
{"action":"write","path":"/tmp/peakui-openclaw-workspace/notes/todo.md","content":"# TODO\\n- Inspect the crash logs","createDirectories":true}
</openclaw_tool>`

export const OPENCLAW_CODE_TOOL_EXAMPLE = `<openclaw_tool name="code">
{"runtime":"python","filename":"summarize.py","code":"print('hello from sandbox')","workspacePath":"analysis/demo","description":"Run a short Python script in the managed workspace"}
</openclaw_tool>`

export const OPENCLAW_BROWSER_TOOL_EXAMPLE = `<openclaw_tool name="browser">
{"action":"open","url":"https://example.com","description":"Open the page and inspect its links and forms"}
</openclaw_tool>`

export const OPENCLAW_UWAF_BROWSER_TOOL_EXAMPLE = `<openclaw_tool name="unified_browser">
{"action":"search","query":"latest Next.js route handlers","browserMode":"direct","description":"Search in the visible shared browser"}
</openclaw_tool>`

export const OPENCLAW_TAX_RETURN_TOOL_EXAMPLE = `<openclaw_tool name="tax_return">
{"action":"generate_review_pdf","folder":"2025/taxes","taxYear":"2025","description":"Create a downloadable tax review PDF from the enabled Knowledge Base folder"}
</openclaw_tool>`

export const OPENCLAW_PDF_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="pdf_document">
{"title":"Project Report","filename":"project-report.pdf","template":"report","subtitle":"Prepared by PeakUI","sections":[{"heading":"Executive Summary","body":"This PDF uses structured sections instead of plain markdown."},{"heading":"Next Steps","bullets":["Review the draft","Download the PDF","Request revisions if needed"]}],"tables":[{"title":"Budget","columns":["Item","Amount"],"rows":[{"Item":"Hosting","Amount":"$299"},{"Item":"Support","Amount":"$500"}]}],"description":"Create a polished downloadable project report PDF"}
</openclaw_tool>`

export const OPENCLAW_WORKBOOK_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="workbook_document">
{"title":"Weekly Services Invoice Workbook","filename":"weekly-services-invoice.xlsx","template":"invoice","sheets":[{"name":"Invoice","title":"Invoice","subtitle":"JLJ IV Enterprises","columns":[{"header":"Date","type":"date"},{"header":"Description","type":"text"},{"header":"Hours","type":"number"},{"header":"Rate","type":"currency"},{"header":"Amount","type":"currency"}],"rows":[{"Date":"2026-06-08","Description":"Professional Services","Hours":8,"Rate":45,"Amount":360},{"Date":"2026-06-09","Description":"Professional Services","Hours":8,"Rate":45,"Amount":360}],"tables":[{"title":"Summary","columns":[{"header":"Metric","type":"text"},{"header":"Value","type":"currency"}],"rows":[{"Metric":"Total Due","Value":720}]}],"notes":["Payment terms: Net 14 days"],"freezeHeader":true,"autoFilter":true}],"metadata":{"creator":"PeakUI","currency":"USD"},"description":"Create a polished Excel invoice workbook"}
</openclaw_tool>`

export const OPENCLAW_WORD_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="word_document">
{"title":"Professional Services Proposal","filename":"professional-services-proposal.docx","template":"proposal","subtitle":"Prepared by PeakUI","fields":[{"label":"Client","value":"Acme Corp"},{"label":"Prepared by","value":"JLJ IV Enterprises"}],"sections":[{"heading":"Executive Summary","body":"This proposal outlines the recommended scope, timeline, and deliverables for the engagement."},{"heading":"Scope of Work","bullets":["Discovery and requirements review","Implementation plan","Delivery and handoff"]},{"heading":"Commercial Terms","tables":[{"title":"Pricing","columns":["Item","Amount"],"rows":[{"Item":"Implementation","Amount":"$4,500"},{"Item":"Support","Amount":"$750"}]}],"callouts":[{"tone":"note","title":"Next Step","text":"Review and approve the proposed scope before kickoff."}]}],"metadata":{"author":"PeakUI","footer":"Generated by PeakUI"},"description":"Create a polished Word proposal document"}
</openclaw_tool>`

export const OPENCLAW_CSV_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="csv_document">
{"title":"Q2 Sales Report","filename":"q2-sales-report.csv","headers":["Region","Product","Units","Revenue"],"rows":[{"Region":"North","Product":"Widget A","Units":120,"Revenue":4800},{"Region":"South","Product":"Widget B","Units":85,"Revenue":3400}],"description":"Export the sales data as a CSV file"}
</openclaw_tool>`

export const OPENCLAW_EMAIL_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="email_document">
{"title":"Follow-up Email","filename":"follow-up-email.eml","to":"client@example.com","from":"team@peakui.local","subject":"Project Kickoff Next Steps","body":"Hi team,\n\nThank you for the kickoff call. The next steps are:\n1. Share access credentials\n2. Confirm timeline\n3. Schedule weekly check-ins\n\nBest,\nPeakUI","description":"Draft a professional follow-up email"}
</openclaw_tool>`

export const OPENCLAW_MARKDOWN_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="markdown_document">
{"title":"Activity Blueprint","filename":"activity-blueprint.md","content":"# Activity Blueprint\n\n## Product Vision\n...","description":"Create a downloadable Markdown version of the blueprint"}
</openclaw_tool>`

export const OPENCLAW_SLIDES_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="slides_document">
{"title":"Q3 Review","filename":"q3-review.pptx","subtitle":"Quarterly business review","theme":{"primaryColor":"1E3A8A","accentColor":"0EA5E9"},"slides":[{"layout":"title","title":"Q3 Review","subtitle":"Quarterly business review"},{"layout":"bullets","title":"Highlights","bullets":["Revenue up 18%","NPS at 47","Three enterprise wins"]},{"layout":"two-column","title":"Risks & Mitigations","columns":[{"heading":"Risks","bullets":["Hiring lag","Supply chain"]},{"heading":"Mitigations","bullets":["Contractor pool","Dual sourcing"]}]},{"layout":"closing","title":"Thank you","body":"Questions?"}],"description":"Generate a polished Q3 review slide deck"}
</openclaw_tool>`

export const OPENCLAW_ARCHIVE_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="archive_document">
{"title":"Q3 Bundle","filename":"q3-bundle.zip","entries":[{"name":"summary.md","mimeType":"text/markdown","content":"# Q3 Summary\n\nStrong quarter."},{"name":"notes.txt","mimeType":"text/plain","content":"Meeting notes from 9/30"}],"description":"Bundle the most recent Q3 artifacts into a single ZIP"}
</openclaw_tool>`

export const OPENCLAW_CALENDAR_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="calendar_document">
{"title":"Project Kickoff","filename":"project-kickoff.ics","events":[{"uid":"kickoff-1","title":"Project Kickoff","description":"Discuss scope and timeline","location":"Zoom","start":"2026-07-01T15:00:00Z","end":"2026-07-01T16:00:00Z","organizer":"team@peakui.local","attendees":["client@example.com"]}],"description":"Create an ICS calendar invite for the kickoff meeting"}
</openclaw_tool>`

export const OPENCLAW_MERMAID_DOCUMENT_TOOL_EXAMPLE = `<openclaw_tool name="mermaid_document">
{"title":"User Login Flow","filename":"user-login-flow.svg","diagram":"graph TD; A[User] --> B[Login Form]; B --> C{Valid?}; C -- Yes --> D[Dashboard]; C -- No --> B","format":"svg","description":"Render a Mermaid diagram of the user login flow as SVG"}
</openclaw_tool>`

export const OPENCLAW_FETCH_SUMMARIZE_TOOL_EXAMPLE = `<openclaw_tool name="fetch_summarize">
{"url":"https://example.com/article","description":"Fetch and summarize the article"}
</openclaw_tool>`

function isUwafAction(value: unknown): value is OpenClawUwafBrowserToolRequest['action'] {
  return value === 'search'
    || value === 'open'
    || value === 'click'
    || value === 'type'
    || value === 'press'
    || value === 'wait_for_selector'
    || value === 'scroll'
    || value === 'back'
    || value === 'forward'
    || value === 'new_tab'
    || value === 'list_tabs'
    || value === 'switch_tab'
    || value === 'close_tab'
    || value === 'select'
    || value === 'hover'
    || value === 'extract_table'
    || value === 'research_batch'
    || value === 'fill'
    || value === 'submit'
    || value === 'extract'
    || value === 'wait_for_user'
}

function isUwafBrowserMode(value: unknown): value is 'direct' | 'stealth' {
  return value === 'direct' || value === 'stealth'
}

function isStealthProfile(value: unknown): value is 'normal' | 'high' {
  return value === 'normal' || value === 'high'
}

function isPdfDocumentTemplate(value: unknown): value is PdfDocumentTemplate {
  return value === 'report' || value === 'memo' || value === 'letter' || value === 'invoice' || value === 'checklist' || value === 'form'
}

function isWordDocumentTemplate(value: unknown): value is WordDocumentTemplate {
  return value === 'report' || value === 'memo' || value === 'letter' || value === 'proposal' || value === 'contract' || value === 'resume' || value === 'checklist' || value === 'form' || value === 'meeting-notes'
}

function isWorkbookTemplate(value: unknown): value is NonNullable<OpenClawWorkbookDocumentToolRequest['template']> {
  return value === 'workbook'
    || value === 'report'
    || value === 'invoice'
    || value === 'budget'
    || value === 'timesheet'
    || value === 'ledger'
    || value === 'inventory'
    || value === 'schedule'
    || value === 'tracker'
}

export const OPENCLAW_TOOL_NAMES = [
  'shell',
  'filesystem',
  'web',
  'code',
  'browser',
  'unified_browser',
  'tax_return',
  'pdf_document',
  'workbook_document',
  'word_document',
  'csv_document',
  'email_document',
  'markdown_document',
  'slides_document',
  'archive_document',
  'calendar_document',
  'mermaid_document',
  'fetch_summarize',
] as const

export type OpenClawToolName = typeof OPENCLAW_TOOL_NAMES[number]

const TOOL_NAME_ALTERNATION = OPENCLAW_TOOL_NAMES.join('|')
const TOOL_BLOCK_PATTERN = new RegExp(
  `<openclaw_tool\\s+name=["'](${TOOL_NAME_ALTERNATION})["']\\s*>([\\s\\S]*?)<\\/openclaw_tool>`,
  'i',
)
const STRIP_COMPLETE_TOOL_TAG = new RegExp(
  `<openclaw_tool\\s+name=["'](${TOOL_NAME_ALTERNATION})["']\\s*>[\\s\\S]*?<\\/openclaw_tool>`,
  'gi',
)
const STRIP_PARTIAL_TOOL_TAG = new RegExp(
  `<openclaw_tool\\s+name=["'](${TOOL_NAME_ALTERNATION})["']\\s*>[\\s\\S]*`,
  'gi',
)
const LEGACY_UWAF_TOOL_BLOCK_PATTERN = /<unified_browser>\s*([\s\S]*?)<\/unified_browser>/i

function extractFirstJsonObject(raw: string): string | null {
  const source = raw.trim()
  const start = source.search(/[\[{]/)
  if (start < 0) return null

  const opening = source[start]
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === opening) {
      depth += 1
      continue
    }

    if (char === closing) {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }

  return null
}

function parseToolJson<T>(raw: string): T | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    const fallback = extractFirstJsonObject(trimmed)
    if (!fallback) return null
    try {
      return JSON.parse(fallback) as T
    } catch {
      return null
    }
  }
}

function findToolBlock(content: string): { toolName: string; rawBlock: string; rawJson: string } | null {
  const match = content.match(TOOL_BLOCK_PATTERN)
  if (match) {
    return {
      toolName: match[1],
      rawBlock: match[0],
      rawJson: match[2],
    }
  }

  const legacyMatch = content.match(LEGACY_UWAF_TOOL_BLOCK_PATTERN)
  if (legacyMatch) {
    return {
      toolName: 'unified_browser',
      rawBlock: legacyMatch[0],
      rawJson: legacyMatch[1],
    }
  }

  return null
}

/** Strip all complete and partial <openclaw_tool> tags from content. */
export function stripAllToolTags(content: string): string {
  // Remove complete tool blocks first
  let cleaned = content.replace(STRIP_COMPLETE_TOOL_TAG, '')
  cleaned = cleaned.replace(/<unified_browser>\s*[\s\S]*?<\/unified_browser>/gi, '')
  // Remove partial/incomplete tags (no closing tag)
  cleaned = cleaned.replace(STRIP_PARTIAL_TOOL_TAG, '')
  cleaned = cleaned.replace(/<unified_browser>\s*[\s\S]*/gi, '')
  // Remove orphaned opening tags
  cleaned = cleaned.replace(/<openclaw_tool[^>]*>/gi, '')
  cleaned = cleaned.replace(/<unified_browser>/gi, '')
  // Remove orphaned closing tags
  cleaned = cleaned.replace(/<\/openclaw_tool>/gi, '')
  cleaned = cleaned.replace(/<\/unified_browser>/gi, '')
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

function isFilesystemAction(value: unknown): value is OpenClawFilesystemToolRequest['action'] {
  return value === 'list'
    || value === 'read'
    || value === 'stat'
    || value === 'write'
    || value === 'append'
    || value === 'mkdir'
}

function isBrowserAction(value: unknown): value is OpenClawBrowserToolRequest['action'] {
  return value === 'open'
    || value === 'click'
    || value === 'fill'
    || value === 'submit'
    || value === 'extract'
}

function isBrowserExtractMode(value: unknown): value is NonNullable<OpenClawBrowserToolRequest['mode']> {
  return value === 'summary'
    || value === 'text'
    || value === 'links'
    || value === 'forms'
    || value === 'html'
}

export function extractOpenClawToolRequest(content: string): {
  cleanedContent: string
  request?: OpenClawToolRequest
} {
  const block = findToolBlock(content)
  if (!block) {
    return { cleanedContent: stripAllToolTags(content) }
  }

  const cleanedContent = stripAllToolTags(content.replace(block.rawBlock, ''))
  const toolName = block.toolName

  try {
    if (toolName === 'web') {
      const parsed = parseToolJson<Partial<OpenClawWebToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const query = typeof parsed.query === 'string' ? parsed.query.trim() : ''
      if (!query) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'web',
          request: {
            query,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    if (toolName === 'shell') {
      const parsed = parseToolJson<Partial<OpenClawShellToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const command = typeof parsed.command === 'string' ? parsed.command.trim() : ''
      if (!command) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'shell',
          request: {
            command,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    if (toolName === 'code') {
      const parsed = parseToolJson<Partial<OpenClawCodeToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const runtime = parsed.runtime === 'python' || parsed.runtime === 'node'
        ? parsed.runtime
        : null
      const code = typeof parsed.code === 'string' ? parsed.code : ''
      const args = Array.isArray(parsed.args)
        ? parsed.args.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
        : undefined

      if (!runtime || !code.trim()) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'code',
          request: {
            runtime,
            code,
            filename: typeof parsed.filename === 'string' && parsed.filename.trim()
              ? parsed.filename.trim()
              : undefined,
            workspacePath: typeof parsed.workspacePath === 'string' && parsed.workspacePath.trim()
              ? parsed.workspacePath.trim()
              : undefined,
            args,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    if (toolName === 'browser') {
      const parsed = parseToolJson<Partial<OpenClawBrowserToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const action = isBrowserAction(parsed.action) ? parsed.action : null

      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawBrowserToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        request.url = parsed.url.trim()
      }

      if (typeof parsed.linkIndex === 'number' && Number.isInteger(parsed.linkIndex) && parsed.linkIndex >= 0) {
        request.linkIndex = parsed.linkIndex
      }

      if (typeof parsed.linkText === 'string' && parsed.linkText.trim()) {
        request.linkText = parsed.linkText.trim()
      }

      if (typeof parsed.formIndex === 'number' && Number.isInteger(parsed.formIndex) && parsed.formIndex >= 0) {
        request.formIndex = parsed.formIndex
      }

      if (parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)) {
        request.values = Object.fromEntries(
          Object.entries(parsed.values)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value.length > 0)
        )
      }

      if (isBrowserExtractMode(parsed.mode)) {
        request.mode = parsed.mode
      }

      if (
        (action === 'open' && !request.url)
        || (action === 'click' && request.linkIndex === undefined && !request.linkText)
        || (action === 'fill' && (request.formIndex === undefined || !request.values || Object.keys(request.values).length === 0))
      ) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'browser',
          request,
        },
      }
    }

    if (toolName === 'unified_browser') {
      const parsed = parseToolJson<Partial<OpenClawUwafBrowserToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const action = isUwafAction(parsed.action) ? parsed.action : null

      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawUwafBrowserToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (typeof parsed.query === 'string' && parsed.query.trim()) {
        request.query = parsed.query.trim()
      }

      if (typeof parsed.providerId === 'string' && /^[a-z0-9-]{2,64}$/i.test(parsed.providerId.trim())) {
        request.providerId = parsed.providerId.trim().toLowerCase()
      }

      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        request.url = parsed.url.trim()
      }

      if (typeof parsed.linkIndex === 'number' && Number.isInteger(parsed.linkIndex) && parsed.linkIndex >= 0) {
        request.linkIndex = parsed.linkIndex
      }

      if (typeof parsed.linkText === 'string' && parsed.linkText.trim()) {
        request.linkText = parsed.linkText.trim()
      }

      if (typeof parsed.formIndex === 'number' && Number.isInteger(parsed.formIndex) && parsed.formIndex >= 0) {
        request.formIndex = parsed.formIndex
      }

      if (parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)) {
        request.values = Object.fromEntries(
          Object.entries(parsed.values)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value.length > 0)
        )
      }

      if (isBrowserExtractMode(parsed.mode)) {
        request.mode = parsed.mode
      }

      if (isUwafBrowserMode(parsed.browserMode)) {
        request.browserMode = parsed.browserMode
      }

      if (isStealthProfile(parsed.stealthProfile)) {
        request.stealthProfile = parsed.stealthProfile
      }

      if (typeof parsed.depth === 'number' && Number.isInteger(parsed.depth) && parsed.depth >= 1 && parsed.depth <= 3) {
        request.depth = parsed.depth
      }

      if (typeof parsed.selector === 'string' && parsed.selector.trim()) {
        request.selector = parsed.selector.trim()
      }

      if (typeof parsed.text === 'string') {
        request.text = parsed.text
      }

      if (typeof parsed.key === 'string' && parsed.key.trim()) {
        request.key = parsed.key.trim()
      }

      if (typeof parsed.tabIndex === 'number' && Number.isInteger(parsed.tabIndex) && parsed.tabIndex >= 0) {
        request.tabIndex = parsed.tabIndex
      }

      if (typeof parsed.timeoutMs === 'number' && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs >= 0) {
        request.timeoutMs = parsed.timeoutMs
      }

      if (typeof parsed.deltaY === 'number' && Number.isFinite(parsed.deltaY)) {
        request.deltaY = parsed.deltaY
      }

      if (typeof parsed.optionValue === 'string' && parsed.optionValue.trim()) {
        request.optionValue = parsed.optionValue.trim()
      }

      if (typeof parsed.optionLabel === 'string' && parsed.optionLabel.trim()) {
        request.optionLabel = parsed.optionLabel.trim()
      }

      if (
        (action === 'search' && !request.query)
        || (action === 'open' && !request.url)
        || (action === 'click' && request.linkIndex === undefined && !request.linkText)
        || (action === 'type' && (!request.selector || request.text === undefined))
        || (action === 'press' && !request.key)
        || (action === 'wait_for_selector' && !request.selector)
        || (action === 'switch_tab' && request.tabIndex === undefined)
        || (action === 'select' && (!request.selector || (!request.optionValue && !request.optionLabel)))
        || (action === 'hover' && !request.selector)
        || (action === 'research_batch' && !request.url)
      ) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'unified_browser',
          request,
        },
      }
    }

    if (toolName === 'tax_return') {
      const parsed = parseToolJson<Partial<OpenClawTaxReturnToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const action = parsed.action === 'fill_pdf_form' ? 'fill_pdf_form' : parsed.action === 'generate_review_pdf' ? 'generate_review_pdf' : null
      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawTaxReturnToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (typeof parsed.folder === 'string' && parsed.folder.trim()) {
        request.folder = parsed.folder.trim()
      }
      if (typeof parsed.taxYear === 'string' && parsed.taxYear.trim()) {
        request.taxYear = parsed.taxYear.trim()
      }
      if (typeof parsed.templateDocumentId === 'string' && parsed.templateDocumentId.trim()) {
        request.templateDocumentId = parsed.templateDocumentId.trim()
      }
      if (parsed.flatten === true) {
        request.flatten = true
      }

      if (action === 'fill_pdf_form' && !request.templateDocumentId) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'tax_return',
          request,
        },
      }
    }

    if (toolName === 'pdf_document') {
      const parsed = parseToolJson<Partial<OpenClawPdfDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      const hasStructuredContent = Boolean(
        Array.isArray(parsed.sections) && parsed.sections.length
        || Array.isArray(parsed.fields) && parsed.fields.length
        || Array.isArray(parsed.tables) && parsed.tables.length
        || Array.isArray(parsed.callouts) && parsed.callouts.length
      )
      if (!title || (!contentText && !hasStructuredContent)) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawPdfDocumentToolRequest = {
        title: title.slice(0, 160),
        content: contentText ? contentText.slice(0, 60000) : undefined,
        filename: typeof parsed.filename === 'string' && parsed.filename.trim()
          ? parsed.filename.trim().slice(0, 180)
          : undefined,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (isPdfDocumentTemplate(parsed.template)) request.template = parsed.template
      if (typeof parsed.subtitle === 'string' && parsed.subtitle.trim()) request.subtitle = parsed.subtitle.trim().slice(0, 240)
      if (Array.isArray(parsed.sections)) request.sections = parsed.sections.slice(0, 30)
      if (Array.isArray(parsed.fields)) request.fields = parsed.fields.slice(0, 120)
      if (Array.isArray(parsed.tables)) request.tables = parsed.tables.slice(0, 12)
      if (Array.isArray(parsed.callouts)) request.callouts = parsed.callouts.slice(0, 20)
      if (parsed.metadata && typeof parsed.metadata === 'object') request.metadata = parsed.metadata

      return {
        cleanedContent,
        request: {
          name: 'pdf_document',
          request,
        },
      }
    }

    if (toolName === 'workbook_document') {
      const parsed = parseToolJson<Partial<OpenClawWorkbookDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const sheets = Array.isArray(parsed.sheets) ? parsed.sheets.slice(0, 20) : []
      if (!title || sheets.length === 0) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'workbook_document',
          request: {
            title: title.slice(0, 160),
            filename: typeof parsed.filename === 'string' && parsed.filename.trim()
              ? parsed.filename.trim().slice(0, 180)
              : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
            template: isWorkbookTemplate(parsed.template) ? parsed.template : undefined,
            sheets,
            metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : undefined,
          },
        },
      }
    }

    if (toolName === 'word_document') {
      const parsed = parseToolJson<Partial<OpenClawWordDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      const hasStructuredContent = Boolean(
        Array.isArray(parsed.sections) && parsed.sections.length
        || Array.isArray(parsed.fields) && parsed.fields.length
        || Array.isArray(parsed.tables) && parsed.tables.length
        || Array.isArray(parsed.callouts) && parsed.callouts.length
      )
      if (!title || (!contentText && !hasStructuredContent)) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: OpenClawWordDocumentToolRequest = {
        title: title.slice(0, 160),
        content: contentText ? contentText.slice(0, 80000) : undefined,
        filename: typeof parsed.filename === 'string' && parsed.filename.trim()
          ? parsed.filename.trim().slice(0, 180)
          : undefined,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      if (isWordDocumentTemplate(parsed.template)) request.template = parsed.template
      if (typeof parsed.subtitle === 'string' && parsed.subtitle.trim()) request.subtitle = parsed.subtitle.trim().slice(0, 240)
      if (Array.isArray(parsed.sections)) request.sections = parsed.sections.slice(0, 40)
      if (Array.isArray(parsed.fields)) request.fields = parsed.fields.slice(0, 140)
      if (Array.isArray(parsed.tables)) request.tables = parsed.tables.slice(0, 14)
      if (Array.isArray(parsed.callouts)) request.callouts = parsed.callouts.slice(0, 24)
      if (parsed.metadata && typeof parsed.metadata === 'object') request.metadata = parsed.metadata

      return {
        cleanedContent,
        request: {
          name: 'word_document',
          request,
        },
      }
    }

    if (toolName === 'csv_document') {
      const parsed = parseToolJson<Partial<OpenClawCsvDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      const rows = Array.isArray(parsed.rows) ? parsed.rows : undefined
      if (!title || (!contentText && !(rows && rows.length > 0))) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'csv_document',
          request: {
            title: title.slice(0, 160),
            filename: typeof parsed.filename === 'string' && parsed.filename.trim()
              ? parsed.filename.trim().slice(0, 180)
              : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
            content: contentText ? contentText.slice(0, 500_000) : undefined,
            headers: Array.isArray(parsed.headers) ? parsed.headers.slice(0, 120) : undefined,
            rows: rows ? rows.slice(0, 50_000) : undefined,
          },
        },
      }
    }

    if (toolName === 'email_document') {
      const parsed = parseToolJson<Partial<OpenClawEmailDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
      const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
      const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : ''
      if (!subject || !body) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'email_document',
          request: {
            title: title ? title.slice(0, 160) : undefined,
            filename: typeof parsed.filename === 'string' && parsed.filename.trim()
              ? parsed.filename.trim().slice(0, 180)
              : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
            to: typeof parsed.to === 'string' ? parsed.to.trim() : undefined,
            from: typeof parsed.from === 'string' ? parsed.from.trim() : undefined,
            subject: subject.slice(0, 400),
            body: body.slice(0, 60_000),
            htmlBody: typeof parsed.htmlBody === 'string' && parsed.htmlBody.trim()
              ? parsed.htmlBody.trim().slice(0, 60_000)
              : undefined,
          },
        },
      }
    }

    if (toolName === 'markdown_document') {
      const parsed = parseToolJson<Partial<OpenClawMarkdownDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      if (!title || !contentText) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'markdown_document',
          request: {
            title: title.slice(0, 160),
            filename: typeof parsed.filename === 'string' && parsed.filename.trim()
              ? parsed.filename.trim().slice(0, 180)
              : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
            content: contentText.slice(0, 500_000),
          },
        },
      }
    }

    if (toolName === 'slides_document') {
      const parsed = parseToolJson<Partial<OpenClawSlidesDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      // Accept common title aliases so a slightly-wrong payload still works.
      const record0 = parsed as unknown as Record<string, unknown>
      const rawTitle = (typeof parsed.title === 'string' && parsed.title.trim())
        || (typeof record0.subject === 'string' && (record0.subject as string).trim())
        || (typeof record0.name === 'string' && (record0.name as string).trim())
        || ''
      // Normalize each slide at parse time so a slide with `content` instead of
      // `bullets` still flows through to the renderer with the right shape.
      const rawSlides = Array.isArray(parsed.slides) ? parsed.slides.slice(0, 60) : []
      const slides = rawSlides
        .map(slide => {
          if (!slide || typeof slide !== 'object') return null
          const source = slide as unknown as Record<string, unknown>
          const record: Record<string, unknown> = { ...source }
          // Coerce `content` (string or array) into `bullets` so the schema
          // normalizer does not silently drop the slide for missing `bullets`.
          if (record.bullets === undefined && record.content !== undefined) {
            if (Array.isArray(record.content)) {
              record.bullets = record.content
            } else if (typeof record.content === 'string') {
              record.bullets = record.content
                .split(/\r?\n/)
                .map((line: string) => line.replace(/^\s*[•\-*]\s+/, '').trim())
                .filter(Boolean)
            }
            delete record.content
          }
          return record as unknown as OpenClawSlidesDocumentToolRequest['slides'][number]
        })
        .filter((slide): slide is OpenClawSlidesDocumentToolRequest['slides'][number] => slide !== null)
      if (slides.length === 0) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const firstSlideTitle = typeof slides[0]?.title === 'string' ? slides[0].title.trim() : ''
      const safeTitle = (rawTitle || firstSlideTitle || 'Untitled Deck').slice(0, 200)
      return {
        cleanedContent,
        request: {
          name: 'slides_document',
          request: {
            title: safeTitle,
            subtitle: typeof parsed.subtitle === 'string' && parsed.subtitle.trim() ? parsed.subtitle.trim().slice(0, 240) : undefined,
            author: typeof parsed.author === 'string' && parsed.author.trim() ? parsed.author.trim().slice(0, 160) : undefined,
            company: typeof parsed.company === 'string' && parsed.company.trim() ? parsed.company.trim().slice(0, 160) : undefined,
            theme: parsed.theme && typeof parsed.theme === 'object' ? parsed.theme : undefined,
            filename: typeof parsed.filename === 'string' && parsed.filename.trim() ? parsed.filename.trim().slice(0, 180) : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
            slides,
          },
        },
      }
    }

    if (toolName === 'archive_document') {
      const parsed = parseToolJson<Partial<OpenClawArchiveDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      // Accept common aliases for the entries array (files, items, contents)
      // and for per-entry content (data, body, text). Drop entries that are
      // missing both `name` and a usable content string.
      const parsedRecord = parsed as unknown as Record<string, unknown>
      const rawEntries = (Array.isArray(parsed.entries) ? parsed.entries
        : Array.isArray(parsedRecord.files) ? (parsedRecord.files as unknown[])
          : Array.isArray(parsedRecord.items) ? (parsedRecord.items as unknown[])
            : Array.isArray(parsedRecord.contents) ? (parsedRecord.contents as unknown[])
              : []).slice(0, 200)
      const entries = rawEntries
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map(entry => {
          const e = { ...entry }
          if (typeof e.content !== 'string') {
            const alias = e.data ?? e.body ?? e.text
            if (typeof alias === 'string') e.content = alias
          }
          if (typeof e.name !== 'string') {
            const alias = e.filename ?? e.path ?? e.file
            if (typeof alias === 'string') e.name = alias
          }
          return e as unknown as OpenClawArchiveDocumentToolRequest['entries'][number]
        })
        .filter(entry => typeof entry.name === 'string' && entry.name.trim().length > 0
          && typeof entry.content === 'string')
      if (!title || entries.length === 0) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      return {
        cleanedContent,
        request: {
          name: 'archive_document',
          request: {
            title: title.slice(0, 200),
            filename: typeof parsed.filename === 'string' && parsed.filename.trim() ? parsed.filename.trim().slice(0, 180) : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
            entries,
          },
        },
      }
    }

    if (toolName === 'calendar_document') {
      const parsed = parseToolJson<Partial<OpenClawCalendarDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      // Each event needs at least a start (uid/end are derived when missing).
      // Accept common start aliases (date, when, time) so a slightly-wrong
      // payload still produces a renderable calendar file. Accept summary
      // as alias for title.
      const rawEvents = Array.isArray(parsed.events) ? parsed.events.slice(0, 200) : []
      const events = rawEvents
        .map(event => {
          if (!event || typeof event !== 'object') return null
          const e = { ...(event as unknown as Record<string, unknown>) }
          if (typeof e.title !== 'string' && typeof e.summary === 'string') {
            e.title = e.summary
          }
          if (typeof e.start !== 'string') {
            const alias = e.date ?? e.when ?? e.time
            if (typeof alias === 'string') e.start = alias
          }
          if (typeof e.start !== 'string' || !e.start.trim()) return null
          return e as unknown as OpenClawCalendarDocumentToolRequest['events'][number]
        })
        .filter((event): event is OpenClawCalendarDocumentToolRequest['events'][number] => event !== null)
      if (events.length === 0) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      return {
        cleanedContent,
        request: {
          name: 'calendar_document',
          request: {
            title: title ? title.slice(0, 200) : 'Calendar',
            filename: typeof parsed.filename === 'string' && parsed.filename.trim() ? parsed.filename.trim().slice(0, 180) : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
            events,
          },
        },
      }
    }

    if (toolName === 'mermaid_document') {
      const parsed = parseToolJson<Partial<OpenClawMermaidDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      // Accept common aliases (code, source, mermaid, syntax) so a model that
      // used a different natural name still produces a renderable diagram.
      const rawDiagram = (parsed.diagram ?? (parsed as Record<string, unknown>).code
        ?? (parsed as Record<string, unknown>).source
        ?? (parsed as Record<string, unknown>).mermaid
        ?? (parsed as Record<string, unknown>).syntax) as unknown
      const diagram = typeof rawDiagram === 'string' ? rawDiagram.trim() : ''
      if (!diagram) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Diagram'
      return {
        cleanedContent,
        request: {
          name: 'mermaid_document',
          request: {
            title: title.slice(0, 200),
            filename: typeof parsed.filename === 'string' && parsed.filename.trim() ? parsed.filename.trim().slice(0, 180) : undefined,
            description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
            diagram: diagram.slice(0, 60_000),
            format: parsed.format === 'png' ? 'png' : 'svg',
          },
        },
      }
    }

    if (toolName === 'fetch_summarize') {
      const parsed = parseToolJson<Partial<OpenClawFetchSummarizeToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const url = typeof parsed.url === 'string' ? parsed.url.trim() : ''
      if (!url) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      return {
        cleanedContent,
        request: {
          name: 'fetch_summarize',
          request: {
            url,
            description: typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : undefined,
          },
        },
      }
    }

    const parsed = parseToolJson<Partial<OpenClawFilesystemToolRequest>>(block.rawJson)
    if (!parsed) {
      return { cleanedContent: stripAllToolTags(content) }
    }
    const requestedPath = typeof parsed.path === 'string' ? parsed.path.trim() : ''
    const action = isFilesystemAction(parsed.action) ? parsed.action : null

    if (!requestedPath || !action) {
      return { cleanedContent: stripAllToolTags(content) }
    }

    if ((action === 'write' || action === 'append') && typeof parsed.content !== 'string') {
      return { cleanedContent: stripAllToolTags(content) }
    }

    const request: OpenClawFilesystemToolRequest = {
      action,
      path: requestedPath,
    }

    if (typeof parsed.content === 'string') {
      request.content = parsed.content
    }

    if (parsed.createDirectories === true) {
      request.createDirectories = true
    }

    return {
      cleanedContent,
      request: {
        name: 'filesystem',
        request,
      },
    }
  } catch {
    return { cleanedContent: stripAllToolTags(content) }
  }
}
