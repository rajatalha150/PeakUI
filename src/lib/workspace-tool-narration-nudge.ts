/**
 * Pure builder for the recovery-nudge message that the runtime sends to the
 * model when it narrated a tool action but never emitted the matching
 * `<workspace_tool>` wrapper.
 *
 * Lives outside `WorkspaceToolWorkspace.tsx` so the message shape is unit-testable
 * without spinning up React. The component just imports `buildNarrationNudgeText`
 * and uses the returned string verbatim.
 *
 * Two output paths:
 *
 * 1. `invalidToolBlock = true` — the model emitted a wrapper but it was
 *    malformed/incomplete/duplicated. The nudge stays generic ("Re-emit
 *    exactly ONE complete tool call") and never shows a literal example,
 *    because the model tends to copy wrapper examples verbatim and that
 *    produces the same malformed result.
 *
 * 2. Narration only (no wrapper at all) — the model described a tool
 *    action in prose. The nudge includes a SHORT placeholder example
 *    using the previously-tracked tool name. **Special case for
 *    `unified_browser`**: when the prior tool was a `unified_browser` and
 *    the prose names a recognizable sub-page, the example URL is pre-filled
 *    with the prior URL so the model has a concrete target to pattern-match
 *    against (not a `<placeholder>` template). This is the failure mode
 *    where the model wrote "I'll proceed to the dark pool flow page now"
 *    and stalled the loop without ever naming a URL.
 */

export interface NarrationNudgeContext {
  /** The most recent successful tool call (any kind). */
  lastSuccessfulToolRequest?: { name: string; request: unknown } | null
  /** The prose the model just emitted (used to pre-fill URLs in the example). */
  proseContent: string
  /** True when the model emitted a wrapper but it failed to parse. */
  invalidToolBlock?: boolean
}

export type WorkspaceToolName =
  | 'shell'
  | 'filesystem'
  | 'code'
  | 'web'
  | 'browser'
  | 'unified_browser'
  | 'tax_return'
  | 'fetch_summarize'
  | 'pdf_document'
  | 'workbook_document'
  | 'word_document'
  | 'csv_document'
  | 'email_document'
  | 'markdown_document'
  | 'slides_document'
  | 'archive_document'
  | 'calendar_document'
  | 'mermaid_document'

const TOOL_DISPLAY_NAME: Readonly<Record<WorkspaceToolName, string>> = {
  shell: 'shell',
  filesystem: 'filesystem',
  code: 'code sandbox',
  web: 'web',
  browser: 'browser',
  unified_browser: 'unified browser',
  tax_return: 'tax return',
  fetch_summarize: 'fetch & summarize',
  pdf_document: 'PDF document',
  workbook_document: 'workbook document',
  word_document: 'Word document',
  csv_document: 'CSV document',
  email_document: 'email document',
  markdown_document: 'markdown document',
  slides_document: 'slides document',
  archive_document: 'archive document',
  calendar_document: 'calendar document',
  mermaid_document: 'mermaid document',
}

export function describeToolDisplayName(name: string | undefined | null): string {
  if (!name) return 'the most relevant tool'
  return TOOL_DISPLAY_NAME[name as WorkspaceToolName] ?? name
}

/**
 * Match common page-name patterns inside prose, mirroring the page-name
 * catalog in `workspace-tool-narration-recovery.ts`. Kept in lockstep so the
 * example URL we pre-fill in the nudge is the same URL the synthesizer
 * would auto-recover. If you add a new catalog entry, add the matching
 * pattern here too — the test suite asserts the symmetry.
 */
const PAGE_NAME_PATTERNS: ReadonlyArray<{ regex: RegExp; buildPath: (m: RegExpMatchArray) => string; site?: RegExp }> = [
  { regex: /\b(?:the\s+)?top\s+options\s+(?:whale\s+)?flow(?:\s+page)?\b/i, buildPath: () => '/market-data/top-options-flow' },
  { regex: /\b(?:the\s+)?(?:top\s+)?dark\s*pool(?:\s+(?:and|&)\s+(?:equit(?:y|ies)\s+)?(?:whale\s+)?flow)?(?:\s+(?:scanner|page))?\b/i, buildPath: () => '/market-data/top-dark-pool-flow' },
  { regex: /\b(?:the\s+)?top\s+open\s+interest(?:\s+(?:changes|change|movements?))?\b/i, buildPath: () => '/market-data/top-open-interest' },
  {
    regex: /\b([A-Z]{1,5})\s+market\s+(?:activity\s+)?tracker\b/i,
    buildPath: (m) => `/market-tracker/${(m[1] || '').toUpperCase()}`,
  },
  {
    regex: /\b(?:the\s+)?([A-Z]{1,5})\s+institutions?(?:\s+(?:page|tab))?\b/i,
    buildPath: (m) => `/stock/${(m[1] || '').toUpperCase()}/institutions`,
  },
  {
    regex: /\b(?:the\s+)?([A-Z]{1,5})\s+overview\b/i,
    buildPath: (m) => `/stock/${(m[1] || '').toUpperCase()}/overview`,
  },
  {
    regex: /\b(?:the\s+)?([A-Z]{1,5})\s+institutional\s+(?:ownership|holders?)\b/i,
    buildPath: (m) => `/institutional/holders-of-${(m[1] || '').toLowerCase()}/`,
  },
  // Financial-research site pages — kept in lockstep with KNOWN_SITE_PAGES in
  // workspace-tool-narration-recovery.ts so the nudge example URL is the same one the
  // synthesizer would dispatch. These build ticker-relative `/stocks/T/...`
  // paths, which is the stockanalysis.com shape. Yahoo (`/quote/T`) and
  // MarketBeat (`/stocks/{EXCHANGE}/T`) use different shapes that only the
  // synthesizer can build correctly (it has the prior URL to extract the
  // ticker / exchange), so the nudge pre-fill is scoped to stockanalysis via
  // the `site` guard; on the other sites the nudge falls back to the generic
  // placeholder and the synthesizer does the real recovery.
  {
    regex: /\b(?:the\s+)?([A-Z]{1,5})\s+forecast(?:\s+page)?\b/i,
    buildPath: (m) => `/stocks/${(m[1] || '').toUpperCase()}/forecast/`,
    site: /^https?:\/\/(?:www\.)?stockanalysis\.com\//i,
  },
  {
    regex: /\b(?:the\s+)?([A-Z]{1,5})\s+financials?\b/i,
    buildPath: (m) => `/stocks/${(m[1] || '').toUpperCase()}/financials/`,
    site: /^https?:\/\/(?:www\.)?stockanalysis\.com\//i,
  },
  {
    regex: /\b(?:the\s+)?([A-Z]{1,5})\s+options(?:\s+(?:page|chain))?\b/i,
    buildPath: (m) => `/stocks/${(m[1] || '').toUpperCase()}/options/`,
    site: /^https?:\/\/(?:www\.)?stockanalysis\.com\//i,
  },
]

/**
 * Try to resolve a recognized page name in the prose against the prior
 * `unified_browser` URL. Returns the absolute URL the synthesizer would
 * construct, or `null` if no match.
 */
function resolvePrefilledUrl(
  prose: string,
  prevUrl: string,
): string | null {
  for (const { regex, buildPath, site } of PAGE_NAME_PATTERNS) {
    if (site && !site.test(prevUrl)) continue
    const m = prose.match(regex)
    if (!m) continue
    const path = buildPath(m)
    if (!path) continue
    try {
      return new URL(path, prevUrl).toString()
    } catch {
      continue
    }
  }
  return null
}

const WRAPPER_EXAMPLES: Readonly<Record<WorkspaceToolName, string>> = {
  shell: '<workspace_tool name="shell">{"command":"<command to run>","description":"<what it does>"}</workspace_tool>',
  filesystem: '<workspace_tool name="shell">{"command":"ls -la <path>","description":"<what you want to know>"}</workspace_tool>',
  code: '<workspace_tool name="code">{"runtime":"python","code":"<script body>","description":"<what the script does>"}</workspace_tool>',
  web: '<workspace_tool name="web">{"query":"<search query>"}</workspace_tool>',
  browser: '<workspace_tool name="browser">{"action":"open","url":"<https URL>","description":"<what to inspect>"}</workspace_tool>',
  unified_browser:
    '<workspace_tool name="unified_browser">{"action":"open","url":"<https URL>","description":"<what to inspect>"}</workspace_tool>',
  tax_return:
    '<workspace_tool name="tax_return">{"action":"generate","folder":"<kb folder>","taxYear":"<YYYY>"}</workspace_tool>',
  fetch_summarize:
    '<workspace_tool name="fetch_summarize">{"url":"<https URL>","description":"<what to summarize>"}</workspace_tool>',
  pdf_document:
    '<workspace_tool name="pdf_document">{"title":"<document title>","description":"<what the user asked for>","sections":[{"heading":"<section heading>","content":"<paragraph>"}]}</workspace_tool>',
  workbook_document:
    '<workspace_tool name="workbook_document">{"title":"<workbook title>","description":"<what the user asked for>","sheets":[{"name":"<sheet name>","columns":["<col a>","<col b>"],"rows":[["<row 1a>","<row 1b>"]]}]}</workspace_tool>',
  word_document:
    '<workspace_tool name="word_document">{"title":"<doc title>","description":"<what the user asked for>","sections":[{"heading":"<heading>","content":"<paragraph>"}]}</workspace_tool>',
  csv_document:
    '<workspace_tool name="csv_document">{"title":"<csv title>","description":"<what the user asked for>","columns":["<col a>","<col b>"],"rows":[["<row 1a>","<row 1b>"]]}</workspace_tool>',
  email_document:
    '<workspace_tool name="email_document">{"subject":"<email subject>","description":"<what the user asked for>","body":"<email body>","to":["<recipient@example.com>"]}</workspace_tool>',
  markdown_document:
    '<workspace_tool name="markdown_document">{"title":"<doc title>","description":"<what the user asked for>","content":"# <heading>\\n\\n<markdown body>"}</workspace_tool>',
  slides_document:
    '<workspace_tool name="slides_document">{"title":"<deck title>","description":"<what the user asked for>","slides":[{"layout":"title","title":"<cover slide title>"},{"layout":"bullets","title":"<section title>","bullets":["<bullet 1>","<bullet 2>"]}]}</workspace_tool>',
  archive_document:
    '<workspace_tool name="archive_document">{"title":"<archive title>","description":"<what the user asked for>","entries":[{"name":"<file.txt>","mimeType":"text/plain","content":"<utf-8 content>"}]}</workspace_tool>',
  calendar_document:
    '<workspace_tool name="calendar_document">{"title":"<calendar title>","description":"<what the user asked for>","events":[{"uid":"<unique-id>","title":"<event title>","start":"<ISO 8601 start>","end":"<ISO 8601 end>"}]}</workspace_tool>',
  mermaid_document:
    '<workspace_tool name="mermaid_document">{"title":"<diagram title>","description":"<what the user asked for>","diagram":"graph TD; A[<node a>] --> B[<node b>]","format":"svg"}</workspace_tool>',
}

const FALLBACK_EXAMPLE = '<workspace_tool name="<registered tool name>">{"<field>":"<value>"}</workspace_tool>'

const GENERIC_INVALID_TEXT =
  'Your last message did not contain a valid tool block — either the wrapper was malformed, incomplete, or duplicated. Re-emit exactly ONE complete tool call (the registered tool names and the exact wrapper format are listed in the system prompt). If no tool is needed, give your final answer directly in plain text instead of starting a wrapper.'

/**
 * Specific guidance for each malformed-wrapper format `detectMalformedToolWrapper`
 * can identify. Naming the exact mistake (and showing the single correct shape)
 * breaks the second-attempt loop that a generic nudge produces — the model
 * otherwise re-emits the same wrong SDK format and burns the nudge budget.
 */
const MALFORMED_WRAPPER_GUIDANCE: Readonly<Record<string, string>> = {
  function_calls:
    'You used the Anthropic-SDK `<function_calls>` / `<invoke>` / `<parameter>` convention. This runtime does NOT parse that — it is stripped and treated as no tool call at all.',
  antml:
    'You used the `<antml:function_calls>` namespaced convention. This runtime does NOT parse that — it is stripped and treated as no tool call at all.',
  invoke:
    'You used the Anthropic-SDK `<invoke>` convention. This runtime does NOT parse that — it is stripped and treated as no tool call at all.',
  parameter:
    'You used the Anthropic-SDK `<parameter name="...">` convention. This runtime does NOT parse that — it is stripped and treated as no tool call at all.',
  tool_use:
    'You used a `<tool_use>` wrapper. This runtime does NOT parse that — it is stripped and treated as no tool call at all.',
  tool_call:
    'You used a `<tool_call>` wrapper. This runtime does NOT parse that — it is stripped and treated as no tool call at all.',
  qwen_tokens:
    'You emitted Qwen-style special tokens (`<|tool_call|>`, `<|im_start|>`, `<|end_of_turn|>`). This runtime strips them and treats the message as no tool call at all.',
}

/**
 * Build a nudge that names the specific malformed wrapper the model emitted
 * and shows the one correct shape. Falls back to the generic invalid-block
 * text when the format is not in the map (e.g. a truncated/duplicated
 * `<workspace_tool>` rather than a foreign SDK convention).
 */
export function buildMalformedWrapperNudgeText(format: string): string {
  const guidance = MALFORMED_WRAPPER_GUIDANCE[format]
  if (!guidance) return GENERIC_INVALID_TEXT
  return `${guidance}

This system uses exactly ONE tool-call format:

<workspace_tool name="TOOL_NAME">{"field":"value"}</workspace_tool>

Re-emit your intended call in that exact form (TOOL_NAME is one of the registered tools listed in the system prompt; the JSON payload must match that tool's documented fields). Do not include any other wrapper, tag, or special token. If no tool is needed, give your final answer directly in plain text.`
}

/**
 * Build the recovery-nudge message.
 *
 * @param ctx.lastSuccessfulToolRequest — the most recent successful tool
 *   call. Used to choose the wrapper example shape (per-tool) and, for
 *   `unified_browser`, to pre-fill the example URL.
 * @param ctx.proseContent — the prose the model just emitted. Used to detect
 *   page-name mentions and pre-fill the example URL.
 * @param ctx.invalidToolBlock — true if the model emitted a wrapper that
 *   failed to parse. When true, no literal wrapper example is shown
 *   (the model tends to copy it verbatim, producing the same malformed
 *   output).
 */
export function buildNarrationNudgeText(ctx: NarrationNudgeContext): string {
  if (ctx.invalidToolBlock) {
    return GENERIC_INVALID_TEXT
  }

  const hintTool = ctx.lastSuccessfulToolRequest?.name as WorkspaceToolName | undefined
  const hintLabel = describeToolDisplayName(hintTool)
  let exampleShape = hintTool
    ? WRAPPER_EXAMPLES[hintTool] ?? FALLBACK_EXAMPLE
    : FALLBACK_EXAMPLE

  // For unified_browser with a recognizable page name in the prose,
  // pre-fill the example URL with the resolved target so the model has
  // something concrete to copy (rather than a `<https URL>` placeholder
  // it might just paste in unchanged).
  if (hintTool === 'unified_browser' && ctx.lastSuccessfulToolRequest) {
    const prev = ctx.lastSuccessfulToolRequest.request as { url?: string } | null
    if (prev?.url && typeof prev.url === 'string') {
      const resolved = resolvePrefilledUrl(ctx.proseContent, prev.url)
      if (resolved) {
        exampleShape = `<workspace_tool name="unified_browser">{"action":"open","url":"${resolved}","description":"<what to inspect>"}</workspace_tool>`
      }
    }
  }

  return `You described what you were about to do but stopped before emitting the matching tool block. The wrapper is mandatory — bare prose, fenced JSON, or partial wrappers are all rejected because the runtime can only act on a complete <workspace_tool> wrapper.

End your reply with exactly ONE complete wrapper for the tool you intended: **${hintLabel}**. Replace the placeholders with real values — do not copy the template verbatim.

${exampleShape}

If you already tried and it was malformed, delete any partial wrapper and emit exactly one clean one. If no tool is needed, give your final answer directly in plain text only.`
}

export const __test__ = {
  WRAPPER_EXAMPLES,
  resolvePrefilledUrl,
  PAGE_NAME_PATTERNS,
  TOOL_DISPLAY_NAME,
}
