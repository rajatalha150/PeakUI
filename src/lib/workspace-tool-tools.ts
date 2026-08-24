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

export interface WorkspaceToolShellToolRequest {
  command: string
  description?: string
}

export interface WorkspaceToolWebToolRequest {
  query: string
  description?: string
}

export interface WorkspaceToolFilesystemToolRequest {
  action: 'list' | 'read' | 'stat' | 'write' | 'append' | 'mkdir'
  path: string
  content?: string
  createDirectories?: boolean
}

export interface WorkspaceToolCodeToolRequest {
  runtime: 'python' | 'node'
  code: string
  filename?: string
  workspacePath?: string
  args?: string[]
  description?: string
}

export interface WorkspaceToolBrowserToolRequest {
  action: 'open' | 'click' | 'fill' | 'submit' | 'extract'
  url?: string
  linkIndex?: number
  linkText?: string
  formIndex?: number
  values?: Record<string, string>
  mode?: 'summary' | 'text' | 'links' | 'forms' | 'html'
  description?: string
}

export interface WorkspaceToolUwafBrowserToolRequest {
  action: 'search' | 'open' | 'click' | 'type' | 'press' | 'wait_for_selector' | 'scroll' | 'back' | 'forward' | 'new_tab' | 'list_tabs' | 'switch_tab' | 'close_tab' | 'select' | 'hover' | 'extract_table' | 'research_batch' | 'fill' | 'submit' | 'extract' | 'wait_for_user' | 'reopen_recent'
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
  /** reopen_recent: which list to reopen from. 'search' picks a prior
   *  search result URL by index; 'tab' picks a prior tab snapshot. */
  recentKind?: 'search' | 'tab'
  /** reopen_recent: 0-based index into searchHistory or tabSnapshots. */
  recentIndex?: number
  description?: string
}

export interface WorkspaceToolTaxReturnToolRequest {
  action: 'generate_review_pdf' | 'fill_pdf_form' | 'list_forms' | 'inspect_form'
  folder?: string
  taxYear?: string
  templateDocumentId?: string
  /** IRS form id (e.g. "f1040", "f1040sd") resolved from the bundled irs_forms catalog. */
  formId?: string
  /** Explicit field-name -> value overlay applied on top of the auto-extracted draft. */
  fields?: Record<string, string>
  flatten?: boolean
  description?: string
}

export interface WorkspaceToolPdfDocumentToolRequest {
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

export type WorkspaceToolWorkbookDocumentToolRequest = WorkbookDocumentInput

export type WorkspaceToolWordDocumentToolRequest = WordDocumentInput

export type WorkspaceToolCsvDocumentToolRequest = CsvDocumentInput

export type WorkspaceToolEmailDocumentToolRequest = EmailDocumentInput

export type WorkspaceToolMarkdownDocumentToolRequest = MarkdownDocumentInput

export type WorkspaceToolSlidesDocumentToolRequest = SlidesDocumentInput

export type WorkspaceToolArchiveDocumentToolRequest = ArchiveDocumentInput

export type WorkspaceToolCalendarDocumentToolRequest = CalendarDocumentInput

export type WorkspaceToolMermaidDocumentToolRequest = MermaidDocumentInput

export interface WorkspaceToolFetchSummarizeToolRequest {
  url: string
  description?: string
}

export type WorkspaceToolRequest =
  | {
      name: 'web'
      request: WorkspaceToolWebToolRequest
    }
  | {
      name: 'shell'
      request: WorkspaceToolShellToolRequest
    }
  | {
      name: 'filesystem'
      request: WorkspaceToolFilesystemToolRequest
    }
  | {
      name: 'code'
      request: WorkspaceToolCodeToolRequest
    }
  | {
      name: 'browser'
      request: WorkspaceToolBrowserToolRequest
    }
  | {
      name: 'unified_browser'
      request: WorkspaceToolUwafBrowserToolRequest
    }
  | {
      name: 'tax_return'
      request: WorkspaceToolTaxReturnToolRequest
    }
  | {
      name: 'pdf_document'
      request: WorkspaceToolPdfDocumentToolRequest
    }
  | {
      name: 'workbook_document'
      request: WorkspaceToolWorkbookDocumentToolRequest
    }
  | {
      name: 'word_document'
      request: WorkspaceToolWordDocumentToolRequest
    }
  | {
      name: 'csv_document'
      request: WorkspaceToolCsvDocumentToolRequest
    }
  | {
      name: 'email_document'
      request: WorkspaceToolEmailDocumentToolRequest
    }
  | {
      name: 'markdown_document'
      request: WorkspaceToolMarkdownDocumentToolRequest
    }
  | {
      name: 'slides_document'
      request: WorkspaceToolSlidesDocumentToolRequest
    }
  | {
      name: 'archive_document'
      request: WorkspaceToolArchiveDocumentToolRequest
    }
  | {
      name: 'calendar_document'
      request: WorkspaceToolCalendarDocumentToolRequest
    }
  | {
      name: 'mermaid_document'
      request: WorkspaceToolMermaidDocumentToolRequest
    }
  | {
      name: 'fetch_summarize'
      request: WorkspaceToolFetchSummarizeToolRequest
    }

export const WORKSPACE_TOOL_WEB_TOOL_EXAMPLE = `<workspace_tool name="web">
{"query":"latest Next.js 16 route handlers docs","description":"Verify the current route-handler behavior before answering"}
</workspace_tool>`

export const WORKSPACE_TOOL_SHELL_TOOL_EXAMPLE = `<workspace_tool name="shell">
{"command":"pwd","description":"Check the current workspace"}
</workspace_tool>`

export const WORKSPACE_TOOL_FILESYSTEM_TOOL_EXAMPLE = `<workspace_tool name="filesystem">
{"action":"read","path":"/home/user/project/src/app.ts"}
</workspace_tool>`

export const WORKSPACE_TOOL_FILESYSTEM_WRITE_TOOL_EXAMPLE = `<workspace_tool name="filesystem">
{"action":"write","path":"~/.peakui/workspace/users/<your-user-id>/workspaces/default/tvcontrol/settings.gradle","content":"rootProject.name = \"TVControlApp\"\\n","createDirectories":true}
</workspace_tool>`

export const WORKSPACE_TOOL_CODE_TOOL_EXAMPLE = `<workspace_tool name="code">
{"runtime":"python","filename":"summarize.py","code":"print('hello from sandbox')","workspacePath":"analysis/demo","description":"Run a short Python script in the managed workspace"}
</workspace_tool>`

export const WORKSPACE_TOOL_BROWSER_TOOL_EXAMPLE = `<workspace_tool name="browser">
{"action":"open","url":"https://example.com","description":"Open the page and inspect its links and forms"}
</workspace_tool>`

export const WORKSPACE_TOOL_UWAF_BROWSER_TOOL_EXAMPLE = `<workspace_tool name="unified_browser">
{"action":"search","query":"latest Next.js route handlers","browserMode":"direct","description":"Search in the visible shared browser"}
</workspace_tool>`

function isUwafAction(value: unknown): value is WorkspaceToolUwafBrowserToolRequest['action'] {
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
    || value === 'reopen_recent'
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

function isWorkbookTemplate(value: unknown): value is NonNullable<WorkspaceToolWorkbookDocumentToolRequest['template']> {
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

export const WORKSPACE_TOOL_NAMES = [
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

export type WorkspaceToolName = typeof WORKSPACE_TOOL_NAMES[number]

const TOOL_NAME_ALTERNATION = WORKSPACE_TOOL_NAMES.join('|')
const TOOL_BLOCK_PATTERN = new RegExp(
  `<workspace_tool\\s+name=["'](${TOOL_NAME_ALTERNATION})["']\\s*>([\\s\\S]*?)<\\/workspace_tool>`,
  'i',
)
const STRIP_COMPLETE_TOOL_TAG = new RegExp(
  `<workspace_tool\\s+name=["'](${TOOL_NAME_ALTERNATION})["']\\s*>[\\s\\S]*?<\\/workspace_tool>`,
  'gi',
)
const STRIP_PARTIAL_TOOL_TAG = new RegExp(
  `<workspace_tool\\s+name=["'](${TOOL_NAME_ALTERNATION})["']\\s*>[\\s\\S]*`,
  'gi',
)
// Legacy UWAF tool block pattern. Captures the whole body between
// the legacy tags; the parser then runs `extractFirstJsonObject` to
// pull the first JSON object out (in case the model accidentally
// concatenated multiple tool calls in one legacy block).
//
// We do NOT require the body to start with `{` here — that check
// happens after the match, by verifying that `extractFirstJsonObject`
// returns a non-null result. This way a hallucinated
// `<unified_browser>` containing XML child elements (e.g.
// `<parameter name="...">...</parameter>` from a different SDK's
// tool-call convention) is still captured, but its body fails the
// JSON parse downstream and the call falls back to prose-only
// recovery instead of being promoted to a tool extraction.
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

/**
 * A field value the model copied verbatim from a recovery-nudge template, e.g.
 * `<https URL>`, `<value>`, `<command to run>`, `<what to inspect>`. These pass
 * a naive `.trim()` truthiness check and then dispatch a broken call (a browser
 * `open` to the literal string `<https URL>`). Reject them so the call is
 * treated as malformed and the model is re-nudged with the example-free path.
 *
 * Conservative: only matches a value that is *entirely* an angle-bracketed
 * descriptive token (letters/digits/spaces/`_`/`.`/`-`), so real values such as
 * `<App />` (contains `/`), `<div>foo</div>` (contains `>` mid-string), or a
 * URL containing query punctuation are kept.
 */
const TEMPLATE_PLACEHOLDER_RE = /^<[a-z][a-z0-9 _.\-]*>$/i

export function isTemplatePlaceholder(value: unknown): boolean {
  return typeof value === 'string' && TEMPLATE_PLACEHOLDER_RE.test(value.trim())
}

/**
 * Trim a tool string field and collapse a copied template placeholder to empty
 * so the existing empty/required-field checks route the call to the malformed
 * branch instead of dispatching it.
 */
function cleanFieldValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || TEMPLATE_PLACEHOLDER_RE.test(trimmed)) return ''
  return trimmed
}

/**
 * Normalize a URL-ish token captured from prose. Keeps an explicit scheme, or
 * promotes a bare domain / domain+path (`stockanalysis.com/stocks/pltr`) to
 * `https://` so narration like "open stockanalysis.com" recovers a real call
 * instead of stalling on the nudge path. Returns `null` when the token is not a
 * recognizable URL so the caller falls through.
 */
const BARE_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/[^\s]*)?$/i

export function normalizeUrlToken(token: string): string | null {
  const t = token.trim().replace(/[.,;:!?…)]+$/, '')
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (BARE_DOMAIN_RE.test(t)) return `https://${t}`
  return null
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
    // Reject legacy matches whose body is not parseable as a JSON
    // object. This prevents a hallucinated `<unified_browser>` block
    // containing XML child elements (e.g. `<parameter>` from a
    // different SDK's tool-call convention) from being promoted to
    // a tool extraction — the prose should fall through to the
    // narration-recovery path instead. The block is still stripped
    // by `stripAllToolTags` so the user never sees it as raw text.
    const body = legacyMatch[1]?.trim() || ''
    if (!body.startsWith('{') && !body.startsWith('[')) {
      return null
    }
    if (!parseToolJson(legacyMatch[1])) {
      return null
    }
    return {
      toolName: 'unified_browser',
      rawBlock: legacyMatch[0],
      rawJson: legacyMatch[1],
    }
  }

  // Foreign model-native tool-call formats (Qwen, Gemma, Llama, Mistral,
  // GLM, Anthropic). Local GGUF models often emit their own native syntax
  // instead of the custom <workspace_tool> wrapper; normalize them to the
  // same { toolName, rawBlock, rawJson } shape so the per-tool validation
  // below runs unchanged.
  const foreign = findForeignToolBlock(content)
  if (foreign) return foreign

  return null
}

/**
 * Foreign model-native tool-call formats, normalized to the same
 * `{ toolName, rawBlock, rawJson }` shape the native `<workspace_tool>`
 * parser produces. Local GGUF models (Qwen, Gemma, Llama, Mistral, GLM,
 * Anthropic-style) often emit their own native syntax instead of the custom
 * wrapper, and the old parser rejected all of them. This recognizes the
 * common ones and normalizes them so the same per-tool validation runs on the
 * result.
 *
 * Missing closing tags/brackets are tolerated: models truncate mid-stream.
 */

const WORKSPACE_TOOL_NAME_SET: ReadonlySet<string> = new Set(WORKSPACE_TOOL_NAMES)

function normalizeForeignToolName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return WORKSPACE_TOOL_NAME_SET.has(trimmed) ? trimmed : null
}

/**
 * Extract a balanced JSON object/array starting at (or after) `start`,
 * skipping leading whitespace. Returns the exact substring and the index just
 * past its closing bracket, or null when no JSON literal begins there.
 */
function extractBalancedJsonAt(content: string, start: number): { json: string; end: number } | null {
  let i = start
  while (i < content.length && (content[i] === ' ' || content[i] === '\t' || content[i] === '\n' || content[i] === '\r')) {
    i += 1
  }
  if (i >= content.length || (content[i] !== '{' && content[i] !== '[')) return null
  const opening = content[i]
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let j = i; j < content.length; j += 1) {
    const ch = content[j]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === opening) { depth += 1; continue }
    if (ch === closing) {
      depth -= 1
      if (depth === 0) return { json: content.slice(i, j + 1), end: j + 1 }
    }
  }
  return null
}

/**
 * Parse a scalar value that may be a JSON literal (number/bool/null/object) or
 * a bare string. Returns the unquoted string when it is not valid JSON.
 */
function parseForeignScalar(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    try { return JSON.parse(trimmed) } catch { return trimmed.slice(1, -1) }
  }
  try { return JSON.parse(trimmed) } catch { return trimmed }
}

/** Split on a top-level single-char delimiter, respecting quotes and nesting. */
function splitTopLevel(raw: string, delimiter: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let current = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      current += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; current += ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; current += ch; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; current += ch; continue }
    if (ch === delimiter && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

/** Index of the first top-level `=` in a Llama-3 kwarg, or -1. */
function findTopLevelEquals(raw: string): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue }
    if (ch === '=' && depth === 0) return i
  }
  return -1
}

/** Parse Llama-3 `.call(k=v, ...)` kwargs into a record. */
function parseLlama3Kwargs(raw: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {}
  for (const part of splitTopLevel(raw, ',')) {
    const eq = findTopLevelEquals(part)
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    args[key] = parseForeignScalar(part.slice(eq + 1))
  }
  return Object.keys(args).length > 0 ? args : null
}

/** Extract `{ name, arguments }` from a parsed foreign JSON envelope. */
function foreignEnvelopeToArgs(parsed: unknown): { name: string; args: Record<string, unknown> } | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const envelope = parsed as { name?: unknown; arguments?: unknown; parameters?: unknown }
  const name = normalizeForeignToolName(envelope.name)
  const args = envelope.arguments ?? envelope.parameters
  if (!name || !args || typeof args !== 'object' || Array.isArray(args)) return null
  return { name, args: args as Record<string, unknown> }
}

function findForeignToolBlock(content: string): { toolName: string; rawBlock: string; rawJson: string } | null {
  // 1. Qwen / Hermes: <tool_call>{"name":"web","arguments":{...}}</tool_call>
  //    (tolerates a missing </tool_call>). Distinguished from GLM by the `{`
  //    immediately after the tag.
  const qwenTag = /<tool_call>/i.exec(content)
  if (qwenTag) {
    const bodyStart = qwenTag.index + qwenTag[0].length
    const balanced = extractBalancedJsonAt(content, bodyStart)
    if (balanced) {
      const envelope = foreignEnvelopeToArgs(parseToolJson(balanced.json))
      if (envelope) {
        return {
          toolName: envelope.name,
          rawBlock: content.slice(qwenTag.index, balanced.end),
          rawJson: JSON.stringify(envelope.args),
        }
      }
    }
  }

  // 2. Anthropic: <invoke name="web"><parameter name="query">x</parameter></invoke>
  //    (standalone, or nested inside <function_calls>).
  const invoke = /<invoke\s+name=["']([\w.\-]+)["']\s*>([\s\S]*?)(?:<\/invoke>|$)/i.exec(content)
  if (invoke) {
    const name = normalizeForeignToolName(invoke[1])
    if (name) {
      const args: Record<string, unknown> = {}
      const paramRe = /<parameter\s+name=["']([\w.\-]+)["']\s*>([\s\S]*?)<\/parameter>/gi
      let m: RegExpExecArray | null
      while ((m = paramRe.exec(invoke[2])) !== null) {
        const key = m[1].trim()
        if (key) args[key] = parseForeignScalar(m[2])
      }
      if (Object.keys(args).length > 0) {
        return { toolName: name, rawBlock: invoke[0], rawJson: JSON.stringify(args) }
      }
    }
  }

  // 3. Llama-3: <|python_tag|>web.call(query="x", k=2)
  const llama = /<\|python_tag\|>\s*([\w.\-]+)\s*\.\s*call\s*\(([\s\S]*?)\)/i.exec(content)
  if (llama) {
    const name = normalizeForeignToolName(llama[1])
    if (name) {
      const args = parseLlama3Kwargs(llama[2])
      if (args) {
        return { toolName: name, rawBlock: llama[0], rawJson: JSON.stringify(args) }
      }
    }
  }

  // 4. Mistral: [TOOL_CALLS] [{"name":"web","arguments":{...}}]
  const mistral = /\[TOOL_CALLS\]\s*\[/i.exec(content)
  if (mistral) {
    const balanced = extractBalancedJsonAt(content, mistral.index + mistral[0].length - 1)
    if (balanced) {
      const parsed = parseToolJson<unknown>(balanced.json)
      const first = Array.isArray(parsed) ? parsed[0] : parsed
      const envelope = foreignEnvelopeToArgs(first)
      if (envelope) {
        return {
          toolName: envelope.name,
          rawBlock: content.slice(mistral.index, balanced.end),
          rawJson: JSON.stringify(envelope.args),
        }
      }
    }
  }

  // 5. Gemma 4: <|tool_call>call:web{"query":"x"}<tool_call|>
  const gemma = /<\|tool_call>\s*call\s*:\s*([\w.\-]+)\s*(\{[\s\S]*?\})/i.exec(content)
  if (gemma) {
    const name = normalizeForeignToolName(gemma[1])
    if (name) {
      const args = parseToolJson<Record<string, unknown>>(gemma[2])
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        return { toolName: name, rawBlock: gemma[0], rawJson: JSON.stringify(args) }
      }
    }
  }

  // 6. GLM 4.5-4.7: <tool_call>web\n<arg_key>query</arg_key>\n<arg_value>x</arg_value></tool_call>
  //    (tolerates a missing </tool_call>). Only reached when the Qwen branch
  //    above did not find a `{` right after the tag.
  const glm = /<tool_call>\s*([\w.\-]+)\s*(?=[\n<])([\s\S]*?)(?:<\/tool_call>|$)/i.exec(content)
  if (glm) {
    const name = normalizeForeignToolName(glm[1])
    if (name) {
      const args: Record<string, unknown> = {}
      const argRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi
      let m: RegExpExecArray | null
      while ((m = argRe.exec(glm[2])) !== null) {
        const key = m[1].trim()
        if (key) args[key] = parseForeignScalar(m[2])
      }
      if (Object.keys(args).length > 0) {
        return { toolName: name, rawBlock: glm[0], rawJson: JSON.stringify(args) }
      }
    }
  }

  // 7. Qwen3.5 XML: <function=web><parameter>query</parameter>x</parameter></function>
  //    (also the attribute form <function name="web">). The user runs several
  //    Qwen3.5 models, which emit this natively.
  const qwenXml = /<function(?:=([\w.\-]+)|\s+name=["']([\w.\-]+)["'])\s*>([\s\S]*?)(?:<\/function>|$)/i.exec(content)
  if (qwenXml) {
    const name = normalizeForeignToolName(qwenXml[1] ?? qwenXml[2])
    if (name) {
      const args: Record<string, unknown> = {}
      const paramRe = /<parameter(?:=([\w.\-]+)|\s+name=["']([\w.\-]+)["'])\s*>([\s\S]*?)<\/parameter>/gi
      let m: RegExpExecArray | null
      while ((m = paramRe.exec(qwenXml[3])) !== null) {
        const key = (m[1] ?? m[2]).trim()
        if (key) args[key] = parseForeignScalar(m[3])
      }
      if (Object.keys(args).length > 0) {
        return { toolName: name, rawBlock: qwenXml[0], rawJson: JSON.stringify(args) }
      }
    }
  }

  // 8. Mistral v11+ named: [TOOL_CALLS]web{"query":"x"} (and [ARGS] variant)
  const mistralNamed = /\[TOOL_CALLS\]\s*([\w.\-]+)\s*(?:\[ARGS\])?\s*(\{[\s\S]*?\})/i.exec(content)
  if (mistralNamed) {
    const name = normalizeForeignToolName(mistralNamed[1])
    if (name) {
      const args = parseToolJson<Record<string, unknown>>(mistralNamed[2])
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        return { toolName: name, rawBlock: mistralNamed[0], rawJson: JSON.stringify(args) }
      }
    }
  }

  return null
}

/** Strip all complete and partial <workspace_tool> tags from content. */
export function stripAllToolTags(content: string): string {
  // Remove complete tool blocks first
  let cleaned = content.replace(STRIP_COMPLETE_TOOL_TAG, '')
  cleaned = cleaned.replace(/<unified_browser>\s*[\s\S]*?<\/unified_browser>/gi, '')
  // Remove partial/incomplete tags (no closing tag)
  cleaned = cleaned.replace(STRIP_PARTIAL_TOOL_TAG, '')
  cleaned = cleaned.replace(/<unified_browser>\s*[\s\S]*/gi, '')
  // Strip well-known malformed tool-call formats the model occasionally
  // hallucinates. These are different SDK conventions (Anthropic,
  // Qwen, etc.) and must never reach the user as visible text.
  cleaned = cleaned.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  cleaned = cleaned.replace(/<function_calls>[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<invoke\s+[^>]*>[\s\S]*?<\/invoke>/gi, '')
  cleaned = cleaned.replace(/<invoke\s+[^>]*>[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<parameter\s+[^>]*>[\s\S]*?<\/parameter>/gi, '')
  cleaned = cleaned.replace(/<parameter\s+[^>]*>[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<antml:function_calls>[\s\S]*?<\/antml:function_calls>/gi, '')
  cleaned = cleaned.replace(/<antml:function_calls>[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  cleaned = cleaned.replace(/<tool_call>[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, '')
  cleaned = cleaned.replace(/<tool_use>[\s\S]*/gi, '')
  // Foreign model-native formats (Gemma, Llama-3, Mistral) — strip them so
  // they never reach the user as visible text, mirroring the parser.
  cleaned = cleaned.replace(/<\|tool_call>\s*call\s*:\s*[\w.\-]+\s*\{[\s\S]*?\}<tool_call\|>/gi, '')
  cleaned = cleaned.replace(/<\|tool_call>\s*call\s*:\s*[\w.\-]+\s*\{[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<\|python_tag\|>\s*[\w.\-]+\s*\.\s*call\s*\([\s\S]*?\)/gi, '')
  cleaned = cleaned.replace(/<\|python_tag\|>\s*[\w.\-]+\s*\.\s*call\s*\([\s\S]*/gi, '')
  cleaned = cleaned.replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\]/gi, '')
  cleaned = cleaned.replace(/\[TOOL_CALLS\]\s*\[[\s\S]*/gi, '')
  cleaned = cleaned.replace(/\[TOOL_CALLS\]\s*[\w.\-]+\s*(?:\[ARGS\])?\s*\{[\s\S]*?\}/gi, '')
  cleaned = cleaned.replace(/\[TOOL_CALLS\]\s*[\w.\-]+\s*(?:\[ARGS\])?\s*\{[\s\S]*/gi, '')
  cleaned = cleaned.replace(/<function(?:=[\w.\-]+|\s+name=["'][\w.\-]+["'])\s*>[\s\S]*?<\/function>/gi, '')
  cleaned = cleaned.replace(/<function(?:=[\w.\-]+|\s+name=["'][\w.\-]+["'])\s*>[\s\S]*/gi, '')
  // Strip the bare closing tokens that leak from those formats.
  cleaned = cleaned.replace(/<\/invoke>/gi, '')
  cleaned = cleaned.replace(/<\/parameter>/gi, '')
  cleaned = cleaned.replace(/<\/antml:function_calls>/gi, '')
  cleaned = cleaned.replace(/<\/tool_call>/gi, '')
  cleaned = cleaned.replace(/<tool_call\|>/gi, '')
  cleaned = cleaned.replace(/<\|tool_call\|>/gi, '')
  cleaned = cleaned.replace(/<\|tool_call_begin\|>/gi, '')
  cleaned = cleaned.replace(/<\|tool_call_end\|>/gi, '')
  cleaned = cleaned.replace(/<\|end_of_turn\|>/gi, '')
  cleaned = cleaned.replace(/<\|endoftext\|>/gi, '')
  cleaned = cleaned.replace(/<\|eot_id\|>/gi, '')
  cleaned = cleaned.replace(/<\|startoftext\|>/gi, '')
  cleaned = cleaned.replace(/<\|begin_of_text\|>/gi, '')
  cleaned = cleaned.replace(/<\|im_end\|>/gi, '')
  cleaned = cleaned.replace(/<\|im_start\|>/gi, '')
  cleaned = cleaned.replace(/<\|end_header_id\|>/gi, '')
  cleaned = cleaned.replace(/<\|start_header_id\|>/gi, '')
  // Strip orphan opening tags from the well-known tool-call formats
  // so the user never sees a bare `<tool_call>`, `<function_calls>`,
  // or `<tool_use>` in the cleaned chat text.
  cleaned = cleaned.replace(/<tool_use>/gi, '')
  cleaned = cleaned.replace(/<tool_use\s+[^>]*>/gi, '')
  cleaned = cleaned.replace(/<tool_call>/gi, '')
  cleaned = cleaned.replace(/<tool_call\s+[^>]*>/gi, '')
  // Remove orphaned opening tags
  cleaned = cleaned.replace(/<workspace_tool[^>]*>/gi, '')
  cleaned = cleaned.replace(/<unified_browser>/gi, '')
  cleaned = cleaned.replace(/<function_calls>/gi, '')
  // Remove orphaned closing tags
  cleaned = cleaned.replace(/<\/workspace_tool>/gi, '')
  cleaned = cleaned.replace(/<\/unified_browser>/gi, '')
  cleaned = cleaned.replace(/<\/function_calls>/gi, '')
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Detect well-known *malformed* tool-call wrappers the model occasionally
 * hallucinates (Anthropic SDK `<function_calls>`/`<invoke>`/`<parameter>`,
 * the `antml:` namespaced variant, `<tool_use>`, and Qwen-style special
 * tokens). These are all silently stripped by `stripAllToolTags`, so without
 * this signal the runtime treats them as plain narration and nudges the
 * model generically — which usually makes it emit the SAME wrong format
 * again and loop.
 *
 * Returns a short label naming the offending format (used by the nudge
 * builder to tell the model exactly what it did wrong and what to emit
 * instead), or `null` when no malformed wrapper is present. Only fires when
 * there is no valid `<workspace_tool>` block — the caller checks that first,
 * so a correct wrapper is never misreported as malformed.
 */
const MALFORMED_WRAPPER_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'antml', re: /<antml:function_calls>/i },
  { label: 'function_calls', re: /<function_calls>/i },
  { label: 'invoke', re: /<invoke\s+[^>]*>/i },
  { label: 'parameter', re: /<parameter\s+name=/i },
  { label: 'tool_use', re: /<tool_use>/i },
  { label: 'tool_call', re: /<tool_call\b/i },
  { label: 'qwen_tokens', re: /<\|tool_call(?:_begin|_end)?\|>|<\|im_start\|>|<\|im_end\|>|<\|end_of_turn\|>/i },
]

export function detectMalformedToolWrapper(content: string): string | null {
  if (typeof content !== 'string' || !content) return null
  for (const { label, re } of MALFORMED_WRAPPER_PATTERNS) {
    if (re.test(content)) return label
  }
  return null
}

function isFilesystemAction(value: unknown): value is WorkspaceToolFilesystemToolRequest['action'] {
  return value === 'list'
    || value === 'read'
    || value === 'stat'
    || value === 'write'
    || value === 'append'
    || value === 'mkdir'
}

function isBrowserAction(value: unknown): value is WorkspaceToolBrowserToolRequest['action'] {
  return value === 'open'
    || value === 'click'
    || value === 'fill'
    || value === 'submit'
    || value === 'extract'
}

function isBrowserExtractMode(value: unknown): value is NonNullable<WorkspaceToolBrowserToolRequest['mode']> {
  return value === 'summary'
    || value === 'text'
    || value === 'links'
    || value === 'forms'
    || value === 'html'
}

/**
 * Best-effort recovery for search/document intents that appear in prose but
 * never received a wrapper. Mirrors the synthesizer logic in
 * workspace-tool-narration-recovery.ts so the parser can also route bare intent.
 */
function parseToolIntentFromProse(content: string): WorkspaceToolRequest | undefined {
  const cleaned = stripAllToolTags(content).trim()
  if (!cleaned) return undefined

  const ubSearch = cleaned.match(/\b(?:let me|i'?ll|i will|now|proceed(?:ing)? to|going to|about to|want to|need to)?\s*(?:run\s+)?(?:a\s+)?(?:unified(?:_|-|\s+)?browser|shared browser|live browser)\s+search\s+(?:for\s+)?["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i)
  if (ubSearch) {
    const query = ubSearch[1].trim()
    if (query.length >= 2 && query.length <= 256) {
      return { name: 'unified_browser', request: { action: 'search', query, browserMode: 'direct' } }
    }
  }

  // The model often plans a search by writing the query out longhand —
  // "Search query: GameStop GME analyst price target current 2026 ..." —
  // without ever wrapping it. Recover that to a `unified_browser` search
  // so the turn does not stall on a nudge round-trip. The "search query"
  // phrase is specific enough that this cannot fire on ordinary prose.
  const searchQuery = cleaned.match(/\bsearch\s+query\s*[:=]\s*["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i)
  if (searchQuery) {
    const query = searchQuery[1].trim()
    if (query.length >= 2 && query.length <= 256) {
      return { name: 'unified_browser', request: { action: 'search', query, browserMode: 'direct' } }
    }
  }

  const urlOpen = cleaned.match(/\b(?:open|visit|fetch|load|check)\s+(?:the\s+)?(?:page\s+|article\s+|site\s+)?(?:at\s+)?["“”'`]*((?:https?:\/\/)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/[^\s<>"'`]*)?)/i)
  if (urlOpen) {
    const url = normalizeUrlToken(urlOpen[1])
    if (url) {
      return { name: 'unified_browser', request: { action: 'open', url } }
    }
  }

  const docCreate = cleaned.match(/\b(?:creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|mak(?:e|ing)|render(?:ing)?|produc(?:e|ing)|writ(?:e|ing))\s+(?:a\s+|the\s+)?(?:new\s+)?(PDF|pdf|Excel|excel|spreadsheet|Word|word|docx|document|deck|slides|presentation|CSV|csv)/i)
  if (docCreate) {
    const kind = docCreate[1].toLowerCase()
    const quoted = cleaned.match(/["“”']([^"“”'\n]+)["“”']/)
    let title = quoted ? quoted[1].trim() : cleaned.replace(/^[^a-zA-Z]+/, '').trim()
    title = title.split(/[.!?]/)[0].replace(/^(?:create|generate|build|make|render|produce|write)\s+/i, '').trim()
    if (!title || title.length > 200) title = 'Generated Document'
    const toolMap: Record<string, WorkspaceToolRequest['name']> = {
      pdf: 'pdf_document', excel: 'workbook_document', spreadsheet: 'workbook_document',
      word: 'word_document', docx: 'word_document', document: 'word_document',
      deck: 'slides_document', slides: 'slides_document', presentation: 'slides_document',
      csv: 'csv_document',
    }
    const name = toolMap[kind]
    if (name) {
      const slide: SlidesDocumentInput = {
        title,
        description: 'auto-recovered from prose',
        slides: [{ layout: 'title', title }],
      }
      const requestByName: Record<string, WorkspaceToolRequest> = {
        pdf_document: { name: 'pdf_document', request: { title, description: 'auto-recovered from prose' } },
        workbook_document: { name: 'workbook_document', request: { title, description: 'auto-recovered from prose', sheets: [{ name: 'Sheet1', columns: [{ header: 'A' }], rows: [] }] } },
        word_document: { name: 'word_document', request: { title, description: 'auto-recovered from prose' } },
        csv_document: { name: 'csv_document', request: { title, description: 'auto-recovered from prose', headers: [], rows: [] } },
        slides_document: { name: 'slides_document', request: slide },
      }
      return requestByName[name]
    }
  }

  return undefined
}

export function extractWorkspaceToolRequest(content: string): {
  cleanedContent: string
  request?: WorkspaceToolRequest
} {
  const block = findToolBlock(content)
  if (!block) {
    const recovered = parseToolIntentFromProse(content)
    if (recovered) {
      return { cleanedContent: stripAllToolTags(content), request: recovered }
    }
    return { cleanedContent: stripAllToolTags(content) }
  }

  const cleanedContent = stripAllToolTags(content.replace(block.rawBlock, ''))
  const toolName = block.toolName

  try {
    if (toolName === 'web') {
      const parsed = parseToolJson<Partial<WorkspaceToolWebToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const query = cleanFieldValue(parsed.query)
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
      const parsed = parseToolJson<Partial<WorkspaceToolShellToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const command = cleanFieldValue(parsed.command)
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
      const parsed = parseToolJson<Partial<WorkspaceToolCodeToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const runtime = parsed.runtime === 'python' || parsed.runtime === 'node'
        ? parsed.runtime
        : null
      const codeRaw = typeof parsed.code === 'string' ? parsed.code : ''
      // Reject a copied `<script body>` placeholder, but otherwise preserve the
      // raw bytes (leading/trailing newlines are common and meaningful in code).
      const codeTrimmed = codeRaw.trim()
      const code = codeTrimmed && TEMPLATE_PLACEHOLDER_RE.test(codeTrimmed) ? '' : codeRaw
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
      const parsed = parseToolJson<Partial<WorkspaceToolBrowserToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const action = isBrowserAction(parsed.action) ? parsed.action : null

      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: WorkspaceToolBrowserToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      const browserUrl = cleanFieldValue(parsed.url)
      if (browserUrl) {
        request.url = browserUrl
      }

      if (typeof parsed.linkIndex === 'number' && Number.isInteger(parsed.linkIndex) && parsed.linkIndex >= 0) {
        request.linkIndex = parsed.linkIndex
      }

      const linkText = cleanFieldValue(parsed.linkText)
      if (linkText) {
        request.linkText = linkText
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
      const parsed = parseToolJson<Partial<WorkspaceToolUwafBrowserToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      const action = isUwafAction(parsed.action) ? parsed.action : null

      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: WorkspaceToolUwafBrowserToolRequest = {
        action,
        description: typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : undefined,
      }

      const ubQuery = cleanFieldValue(parsed.query)
      if (ubQuery) {
        request.query = ubQuery
      }

      if (typeof parsed.providerId === 'string' && /^[a-z0-9-]{2,64}$/i.test(parsed.providerId.trim())) {
        request.providerId = parsed.providerId.trim().toLowerCase()
      }

      const ubUrl = cleanFieldValue(parsed.url)
      if (ubUrl) {
        request.url = ubUrl
      }

      if (typeof parsed.linkIndex === 'number' && Number.isInteger(parsed.linkIndex) && parsed.linkIndex >= 0) {
        request.linkIndex = parsed.linkIndex
      }

      const ubLinkText = cleanFieldValue(parsed.linkText)
      if (ubLinkText) {
        request.linkText = ubLinkText
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

      const selector = cleanFieldValue(parsed.selector)
      if (selector) {
        request.selector = selector
      }

      if (typeof parsed.text === 'string') {
        // Preserve an explicit empty-string `type` (clearing a field) but
        // nullify a copied `<text>`/`<value>` placeholder so the `type`
        // action falls through to the malformed branch instead of typing
        // the literal placeholder.
        const t = parsed.text.trim()
        request.text = t && TEMPLATE_PLACEHOLDER_RE.test(t) ? undefined : parsed.text
      }

      const pressKey = cleanFieldValue(parsed.key)
      if (pressKey) {
        request.key = pressKey
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

      if (parsed.recentKind === 'search' || parsed.recentKind === 'tab') {
        request.recentKind = parsed.recentKind
      }

      if (typeof parsed.recentIndex === 'number' && Number.isInteger(parsed.recentIndex) && parsed.recentIndex >= 0) {
        request.recentIndex = parsed.recentIndex
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
        || (action === 'reopen_recent' && (!request.recentKind || request.recentIndex === undefined))
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
      const parsed = parseToolJson<Partial<WorkspaceToolTaxReturnToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const action =
        parsed.action === 'fill_pdf_form' ? 'fill_pdf_form'
        : parsed.action === 'generate_review_pdf' ? 'generate_review_pdf'
        : parsed.action === 'list_forms' ? 'list_forms'
        : parsed.action === 'inspect_form' ? 'inspect_form'
        : null
      if (!action) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: WorkspaceToolTaxReturnToolRequest = {
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
      if (typeof parsed.formId === 'string' && parsed.formId.trim()) {
        request.formId = parsed.formId.trim()
      }
      if (parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields)) {
        const fields: Record<string, string> = {}
        for (const [key, value] of Object.entries(parsed.fields)) {
          if (typeof key === 'string' && key.trim() && (typeof value === 'string' || typeof value === 'number')) {
            fields[key.trim()] = String(value)
          }
        }
        if (Object.keys(fields).length > 0) request.fields = fields
      }
      if (parsed.flatten === true) {
        request.flatten = true
      }

      // fill_pdf_form needs a template source: either an uploaded template
      // document id, or a bundled IRS form id. inspect_form needs a formId.
      if (action === 'fill_pdf_form' && !request.templateDocumentId && !request.formId) {
        return { cleanedContent: stripAllToolTags(content) }
      }
      if (action === 'inspect_form' && !request.formId) {
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
      const parsed = parseToolJson<Partial<WorkspaceToolPdfDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      // The full structure is a strong recommendation, not a requirement: a
      // title alone (optionally with a description) is enough to generate a
      // PDF. The route falls back to the description as body content.
      if (!title) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: WorkspaceToolPdfDocumentToolRequest = {
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
      const parsed = parseToolJson<Partial<WorkspaceToolWorkbookDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const sheets = Array.isArray(parsed.sheets) ? parsed.sheets.slice(0, 20) : []
      // The full structure is a strong recommendation, not a requirement: a
      // title alone (optionally with a description) is enough to generate a
      // workbook. The route synthesizes a Notes sheet when none has rows.
      if (!title) {
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
            sheets: sheets.length ? sheets : undefined,
            metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : undefined,
          },
        },
      }
    }

    if (toolName === 'word_document') {
      const parsed = parseToolJson<Partial<WorkspaceToolWordDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      // The full structure is a strong recommendation, not a requirement: a
      // title alone (optionally with a description) is enough to generate a
      // document. The route falls back to the description as body content.
      if (!title) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const request: WorkspaceToolWordDocumentToolRequest = {
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
      const parsed = parseToolJson<Partial<WorkspaceToolCsvDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      const rows = Array.isArray(parsed.rows) ? parsed.rows : undefined
      // The full structure is a strong recommendation, not a requirement: a
      // title alone (optionally with a description) is enough to generate a
      // CSV. The route falls back to the description as the body.
      if (!title) {
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
      const parsed = parseToolJson<Partial<WorkspaceToolEmailDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
      const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
      const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : ''
      const description = typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : ''
      // The full structure is a strong recommendation, not a requirement: a
      // title alone (optionally with a description) is enough to generate an
      // email draft. The route defaults the subject from the title and the
      // body from the description.
      if (!subject && !body && !title && !description) {
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
      const parsed = parseToolJson<Partial<WorkspaceToolMarkdownDocumentToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      // The full structure is a strong recommendation, not a requirement: a
      // title alone (optionally with a description) is enough to generate a
      // markdown file. The route falls back to the description as the body,
      // then to a title heading.
      if (!title) {
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
      const parsed = parseToolJson<Partial<WorkspaceToolSlidesDocumentToolRequest>>(block.rawJson)
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
          return record as unknown as WorkspaceToolSlidesDocumentToolRequest['slides'][number]
        })
        .filter((slide): slide is WorkspaceToolSlidesDocumentToolRequest['slides'][number] => slide !== null)
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
      const parsed = parseToolJson<Partial<WorkspaceToolArchiveDocumentToolRequest>>(block.rawJson)
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
          return e as unknown as WorkspaceToolArchiveDocumentToolRequest['entries'][number]
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
      const parsed = parseToolJson<Partial<WorkspaceToolCalendarDocumentToolRequest>>(block.rawJson)
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
          return e as unknown as WorkspaceToolCalendarDocumentToolRequest['events'][number]
        })
        .filter((event): event is WorkspaceToolCalendarDocumentToolRequest['events'][number] => event !== null)
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
      const parsed = parseToolJson<Partial<WorkspaceToolMermaidDocumentToolRequest>>(block.rawJson)
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
      const parsed = parseToolJson<Partial<WorkspaceToolFetchSummarizeToolRequest>>(block.rawJson)
      if (!parsed) {
        return { cleanedContent: stripAllToolTags(content) }
      }

      const url = cleanFieldValue(parsed.url)
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

    const parsed = parseToolJson<Partial<WorkspaceToolFilesystemToolRequest>>(block.rawJson)
    if (!parsed) {
      return { cleanedContent: stripAllToolTags(content) }
    }
    const requestedPath = cleanFieldValue(parsed.path)
    const action = isFilesystemAction(parsed.action) ? parsed.action : null

    if (!requestedPath || !action) {
      return { cleanedContent: stripAllToolTags(content) }
    }

    if ((action === 'write' || action === 'append') && typeof parsed.content !== 'string') {
      return { cleanedContent: stripAllToolTags(content) }
    }

    const request: WorkspaceToolFilesystemToolRequest = {
      action,
      path: requestedPath,
    }

    if (typeof parsed.content === 'string') {
      // Nullify a copied `<content>` placeholder so a write/append falls
      // through to the malformed branch instead of writing the literal
      // token to disk.
      const c = parsed.content.trim()
      request.content = c && TEMPLATE_PLACEHOLDER_RE.test(c) ? undefined : parsed.content
    }

    if ((action === 'write' || action === 'append') && request.content === undefined) {
      return { cleanedContent: stripAllToolTags(content) }
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
