/**
 * Best-effort recovery for the model when it describes an imminent tool call
 * in prose but never emits the matching `<openclaw_tool>` wrapper. The runtime
 * has historically dropped the wrapper for less-common tools (tax_return,
 * fetch_summarize, all 11 document generators) and for first-class tools
 * whenever narration wins over the schema. Without this layer the loop wastes
 * up to two model invocations on a hidden recovery nudge and then surfaces a
 * "Reply continue" stall notice — bad UX.
 *
 * This module is a *pure* synthesizer. It takes the assistant's prose and a
 * small context (last successful tool request + allowed filesystem roots) and
 * returns either a synthesized tool call or `null`. The runtime can then
 * dispatch the result directly without round-tripping through the model.
 *
 * Only high-confidence patterns are synthesized. Anything ambiguous returns
 * `null` so the existing nudge path can take over.
 */

import {
  OPENCLAW_TOOL_NAMES,
  OpenClawToolRequest,
} from './openclaw-tools'

export interface NarrationRecovery {
  toolName: string
  args: Record<string, unknown>
  matchedPattern: string
}

export interface NarrationRecoveryContext {
  /**
   * The most recent successful tool call (any kind). Used by the synthesizer
   * to regenerate prior artifacts when the narration says "regenerate it" or
   * "render the same thing again". Same re-submission is safe because the
   * prior request already passed validation and ran end-to-end.
   */
  lastSuccessfulToolRequest?: { name: string; request: unknown } | null
  /**
   * Allowed filesystem roots in addition to the implicit `/home` and `/tmp`
   * prefixes. Used by the filesystem synthesizer to validate paths before
   * dispatching; paths outside the allowlist fall through to the nudge path.
   */
  allowedPaths?: ReadonlyArray<string>
}

const OPENCLAW_TOOL_NAME_SET: ReadonlySet<string> = new Set(OPENCLAW_TOOL_NAMES)

const DOCUMENT_TOOL_NAMES = [
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
] as const

const REGENERATE_KEYWORDS = new RegExp(
  [
    'regenerate',
    'regen(?:erating)?',
    'rebuild(?:ing)?',
    'rerender(?:ing)?',
    're-render(?:ing)?',
    'render(?:ing)? (?:it|that|the same|again|once more)',
    'generate (?:it|that|the same|again|once more)',
    'recreate(?:ing)?',
    'reproduce',
    'redo(?:ing)?',
    'try again',
    'do (?:it|that) again',
    'same thing',
    'with the same',
  ].join('|'),
  'i',
)

const FETCH_SUMMARIZE_RE =
  /\b(?:fetch(?:ing)?|grab(?:bing)?|pull(?:ing)?|load(?:ing)?|open(?:ing)?|visit(?:ing)?)\s+(?:the (?:page|article|URL|link|website|site)|(?:for\s+)?(?:a|the|an)?\s*(?:summary of|details about|information on|info on))?\s*(?:<url>)?(https?:\/\/[^\s<>"'`]+)/i

const WEB_QUERY_RE_LIST: ReadonlyArray<RegExp> = [
  /\b(?:let me|i'?ll|now|i'll|i will|proceed(?:ing)? to|going to|about to|want to|need to)?\s*search(?:ing)?\s+(?:the web|online|the internet|for)\s+["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i,
  /\bsearch(?:ing)?\s+(?:the web\s+)?for\s+["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i,
  /\b(?:let me|i'?ll|i will|now|proceed(?:ing)? to|going to|about to)?\s*look(?:ing)?\s+up\s+["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i,
  /\b(?:let me|i'?ll|i will|now|proceed(?:ing)? to|going to)?\s*google\s+["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i,
]

const SHELL_COMMAND_RE_LIST: ReadonlyArray<RegExp> = [
  // Back-quoted command (single or double backticks). No trailing \b because
  // the closing quote is followed by a space (non-word), which is not a word
  // boundary — drop the assertion and let the captured group define the match.
  /\b(?:run(?:ning)?|execut(?:e|ing)|invok(?:e|ing)|spawn(?:ing)?)\s+[`'"]+([^\n`'"]+?)[`'"]+/i,
  // Quoted code-block style ```command```
  /```(?:bash|sh|shell|zsh)?\s*\n?\s*([^\n]+?)\s*\n?```/i,
]

const CODE_BLOCK_RE_LIST: ReadonlyArray<RegExp> = [
  /```(?:python|py)\s*\n([\s\S]+?)\n```/i,
  /```(?:javascript|js|typescript|ts)\s*\n([\s\S]+?)\n```/i,
  /```(?:node)\s*\n([\s\S]+?)\n```/i,
]

const UNIFIED_BROWSER_URL_RE = /\bnavigat(?:e|ing)\s+(?:to|over to)\s+(?:<url>)?(https?:\/\/[^\s<>"'`]+)/i
const UNIFIED_BROWSER_URL_RE_2 = /\bopen(?:ing)?\s+(?:<url>)?(https?:\/\/[^\s<>"'`]+)\s+in\s+(?:a |the )?browser\b/i
const UNIFIED_BROWSER_URL_RE_3 = /\b(?:let me|i'?ll|i will|now|proceed(?:ing)? to|going to|about to)?\s*(?:open|visit|fetch|load|check)\s+(?:the\s+)?(?:page\s+|article\s+|site\s+)?(?:at\s+)?(?:<url>)?(https?:\/\/[^\s<>"'`]+)/i

const UNIFIED_BROWSER_SEARCH_RE_LIST: ReadonlyArray<RegExp> = [
  /\b(?:let me|i'?ll|i will|now|proceed(?:ing)? to|going to|about to|want to|need to)?\s*(?:run\s+)?(?:a\s+)?(?:unified(?:_|-|\s+)?browser|shared browser|live browser)\s+search\s+(?:for\s+)?["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i,
  /\bsearch(?:ing)?\s+(?:the\s+)?(?:shared|live|unified(?:_|-|\s+)?)?browser\s+(?:for\s+)?["“”'`]*([^\n"“”'`]+?)[.)\]"'`<,!?:;\s]*$/i,
]

const TAX_YEAR_RE = /\b(?:generat(?:e|ing)|build(?:ing)?|creat(?:e|ing)|prepar(?:e|ing)|run(?:ning)?)\s+(?:a |the )?(?:tax\s+return|tax\s+form|tax\s+document)\s+for\s+(\d{4})\b/i

const DOCUMENT_CREATE_RE_LIST: ReadonlyArray<RegExp> = [
  /\b(?:creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|mak(?:e|ing)|render(?:ing)?|produc(?:e|ing)|writ(?:e|ing))\s+(?:a\s+|the\s+)?(?:new\s+)?(PDF|pdf|Excel|excel|spreadsheet|Word|word|docx|document|deck|slides|presentation|CSV|csv|email|eml|markdown|md|archive|zip|calendar|ics|mermaid|diagram)\b/i,
  /\b(?:creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|mak(?:e|ing)|render(?:ing)?)\s+(?:a\s+|the\s+)?(?:new\s+)?(?:car\s+)?(?:fixing\s+)?(?:repair\s+)?(?:cheat\s+sheet|guide|manual|checklist|report|memo|invoice|letter|proposal|contract|resume|meeting[- ]notes)\b/i,
]

const DOCUMENT_CREATE_KIND_MAP: Readonly<Record<string, typeof DOCUMENT_TOOL_NAMES[number]>> = {
  pdf: 'pdf_document',
  pdf_document: 'pdf_document',
  excel: 'workbook_document',
  spreadsheet: 'workbook_document',
  workbook: 'workbook_document',
  word: 'word_document',
  docx: 'word_document',
  document: 'word_document',
  deck: 'slides_document',
  slides: 'slides_document',
  presentation: 'slides_document',
  csv: 'csv_document',
  email: 'email_document',
  eml: 'email_document',
  markdown: 'markdown_document',
  md: 'markdown_document',
  archive: 'archive_document',
  zip: 'archive_document',
  calendar: 'calendar_document',
  ics: 'calendar_document',
  mermaid: 'mermaid_document',
  diagram: 'mermaid_document',
}

/**
 * Public entry point. Pure: same inputs → same outputs. Returns `null` when
 * no high-confidence pattern matches; the runtime then falls through to the
 * existing recovery-nudge branch.
 */
export function synthesizeToolCallFromNarration(
  content: string,
  ctx: NarrationRecoveryContext = {},
): NarrationRecovery | null {
  if (typeof content !== 'string' || !content.trim()) return null

  const cleaned = content.replace(/<openclaw_tool[\s\S]*?<\/openclaw_tool>/gi, '').trim()
  if (!cleaned) return null

  const allowedPaths = ctx.allowedPaths ?? []

  // Shell — try before filesystem because back-quoted commands often contain
  // an absolute path that the filesystem synthesizer would otherwise pick up
  // first (e.g. `ls -la /home/raza`).
  const lastToolName = ctx.lastSuccessfulToolRequest?.name

  // Unified browser — search intent. Prefer this over the legacy `web` tool
  // when the user is in a browsing workflow or asks for a live browser search.
  const ubSearch = synthesizeUnifiedBrowserSearch(cleaned)
  if (ubSearch) return ubSearch

  const shell = synthesizeShell(cleaned)
  if (shell) return shell

  // Code — fenced code block.
  const code = synthesizeCode(cleaned)
  if (code) return code

  // Web — query after "searching for" / "looking up". Only synthesize the
  // legacy web tool if the last successful tool was NOT unified_browser,
  // because a browsing session should stay inside unified_browser.
  if (lastToolName !== 'unified_browser') {
    const web = synthesizeWeb(cleaned)
    if (web) return web
  }

  // fetch_summarize — URL after "fetching" / "grabbing the page".
  const fetchResult = synthesizeFetchSummarize(cleaned)
  if (fetchResult) return fetchResult

  // Unified browser — navigate/open URL.
  const browser = synthesizeUnifiedBrowser(cleaned)
  if (browser) return browser

  // Unified browser — page-name recovery (fallback when prose names a
  // sub-page of the same site as the last successful tool call but no URL
  // is in the prose). This catches the high-frequency "I'll proceed to
  // the X page" failure mode without a second model invocation.
  const browserByName = synthesizeUnifiedBrowserByPageName(cleaned, ctx)
  if (browserByName) return browserByName

  // Filesystem — highest-frequency bug surface per the chat transcript; runs
  // after shell so commands with embedded paths go to shell first.
  const filesystem = synthesizeFilesystem(cleaned, allowedPaths)
  if (filesystem) return filesystem

  // Tax return — year in "for <year>".
  const tax = synthesizeTaxReturn(cleaned)
  if (tax) return tax

  // Document creation — recover from prose like "create a PDF about X" when
  // no wrapper was emitted. This is a safety net, not a primary path.
  if (!lastToolName || DOCUMENT_TOOL_NAMES.includes(lastToolName as typeof DOCUMENT_TOOL_NAMES[number])) {
    const documentCreate = synthesizeDocumentCreate(cleaned)
    if (documentCreate) return documentCreate
  }

  // Document regenerate — reuse the last successful call when narration says so.
  if (ctx.lastSuccessfulToolRequest && DOCUMENT_TOOL_NAMES.includes(ctx.lastSuccessfulToolRequest.name as typeof DOCUMENT_TOOL_NAMES[number])) {
    const regenerate = synthesizeDocumentRegenerate(cleaned, ctx.lastSuccessfulToolRequest)
    if (regenerate) return regenerate
  }

  return null
}

function isAbsoluteUnixPath(value: string): boolean {
  return value.startsWith('/')
}

function pathLooksLikeHostFilesystemTarget(
  requestedPath: string,
  allowedPaths: ReadonlyArray<string>,
): boolean {
  if (requestedPath.startsWith('/home') || requestedPath.startsWith('/tmp')) {
    return true
  }
  return allowedPaths.some(
    root =>
      requestedPath === root
      || requestedPath.startsWith(`${root}/`)
      || root.startsWith(`${requestedPath}/`),
  )
}

function sanitizeExtractedPath(value: string): string {
  // Drop a trailing punctuation cluster that's almost always prose, not path.
  let cleaned = value.replace(/[`"')\]<>]+/g, '').trim()
  // Strip a trailing period/comma/ellipsis that doesn't belong to the path.
  cleaned = cleaned.replace(/[.,;:!?…]+$/g, '')
  return cleaned.trim()
}

interface FilesystemVerb {
  action: 'stat' | 'read' | 'list'
  // The phrase that introduced the path; helps with verb-specific selection.
  verb: RegExp
}

const FILESYSTEM_VERBS: ReadonlyArray<FilesystemVerb> = [
  {
    action: 'stat',
    verb: /\b(?:inspect(?:ing)?\s+path\s+metadata(?:\s+(?:of|for))?|stat(?:ing|ing)?|metadata (?:of|for)|file info(?:rmation)? (?:of|for)|info(?:rmation)? (?:about|on))\b/i,
  },
  {
    action: 'read',
    verb: /\b(?:read(?:ing)?|cat(?:ting)?|open(?:ing)?|view(?:ing)?|show(?:ing)?|display(?:ing)?)\b/i,
  },
  {
    action: 'list',
    verb: /\b(?:list(?:ing)?|ls\b|show(?:ing)?\s+(?:the\s+)?contents(?:\s+of)?|browse|contents\s+of)\b/i,
  },
]

function synthesizeFilesystem(content: string, allowedPaths: ReadonlyArray<string>): NarrationRecovery | null {
  // Capture the first absolute path. Avoid matching relative paths or URLs.
  const pathMatch = content.match(/(?<![/\w])((\/[A-Za-z0-9._\-+@]+){1,}\/?)/)
  if (!pathMatch) return null
  const path = sanitizeExtractedPath(pathMatch[1])
  if (!path || !isAbsoluteUnixPath(path) || !pathLooksLikeHostFilesystemTarget(path, allowedPaths)) {
    return null
  }

  // Pick the verb from the LAST sentence that mentions the path; that mirrors
  // how a model layers prose ("Let me first stat <p>, then I'll read it").
  // Split on newlines, question marks, and exclamation points only — a period
  // may appear inside a path (`foo.txt`) or inside an abbreviation and must not
  // tear the path in two.
  const sentences = content.split(/[!?\n]+/).map(s => s.trim()).filter(Boolean)
  let chosenAction: 'stat' | 'read' | 'list' | null = null
  // Walk sentences in order and let the LAST verb-bearing sentence win; that
  // mirrors how a model layers prose ("I'll first stat <p>, then I'll read it").
  for (const sentence of sentences) {
    if (!sentence.includes(path)) continue
    for (const verb of FILESYSTEM_VERBS) {
      if (verb.verb.test(sentence)) {
        chosenAction = verb.action
      }
    }
  }

  // If we still couldn't pin a verb, fall through to the nudge path. Defaulting
  // to `stat` here was wrong — it turned `read` narration into a `stat` call.
  if (!chosenAction) return null

  // If we still couldn't pin a verb, fall through to the nudge path. Defaulting
  // to `stat` here was wrong — it turned `read` narration into a `stat` call.
  if (!chosenAction) return null

  return {
    toolName: 'filesystem',
    args: { action: chosenAction, path },
    matchedPattern: `filesystem.${chosenAction}`,
  }
}

function synthesizeShell(content: string): NarrationRecovery | null {
  for (const pattern of SHELL_COMMAND_RE_LIST) {
    const match = content.match(pattern)
    if (!match) continue
    const command = (match[1] || '').trim()
    if (!command || command.length > 4096) continue
    // Reject shell metacharacters — we only synthesize safe inspection commands.
    if (/[|&;<>$()\\\n]/.test(command)) continue
    return {
      toolName: 'shell',
      args: {
        command,
        description: 'auto-recovered from prose narration',
      },
      matchedPattern: 'shell.backtick',
    }
  }

  // Plain-text "running <command>" without backticks, only when the trailing
  // token looks like a simple binary invocation (e.g. "running df -h").
  const trailing = content.match(/(?:^|\s)(?:run(?:ning)?|execut(?:e|ing))\s+([a-zA-Z][a-zA-Z0-9._\-+]*\s+(?:-[a-zA-Z0-9]+\s+)*[^\s.]+)\s*[.)\]"'`<,!?:;\s]*$/i)
  if (trailing) {
    const command = trailing[1].trim()
    if (command && !/[|&;<>$()\\\n]/.test(command) && command.length <= 1024) {
      return {
        toolName: 'shell',
        args: { command, description: 'auto-recovered from prose narration' },
        matchedPattern: 'shell.trailing',
      }
    }
  }

  return null
}

function synthesizeCode(content: string): NarrationRecovery | null {
  for (const pattern of CODE_BLOCK_RE_LIST) {
    const match = content.match(pattern)
    if (!match) continue
    const code = match[1]?.trim()
    if (!code) continue
    const lang = pattern.source.includes('python') ? 'python' : pattern.source.includes('node') ? 'node' : 'javascript'
    return {
      toolName: 'code',
      args: {
        language: lang,
        code,
        description: 'auto-recovered from prose narration',
      },
      matchedPattern: `code.${lang}`,
    }
  }
  return null
}

function synthesizeWeb(content: string): NarrationRecovery | null {
  for (const pattern of WEB_QUERY_RE_LIST) {
    const match = content.match(pattern)
    if (!match) continue
    const query = (match[1] || '').trim()
    if (!query || query.length < 2 || query.length > 256) continue
    return {
      toolName: 'web',
      args: { query, description: 'auto-recovered from prose narration' },
      matchedPattern: 'web.query',
    }
  }
  return null
}

function synthesizeFetchSummarize(content: string): NarrationRecovery | null {
  const match = content.match(FETCH_SUMMARIZE_RE)
  if (!match) return null
  const url = (match[1] || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) return null
  return {
    toolName: 'fetch_summarize',
    args: { url, description: 'auto-recovered from prose narration' },
    matchedPattern: 'fetch_summarize.url',
  }
}

function synthesizeUnifiedBrowserSearch(content: string): NarrationRecovery | null {
  for (const pattern of UNIFIED_BROWSER_SEARCH_RE_LIST) {
    const match = content.match(pattern)
    if (!match) continue
    const query = (match[1] || '').trim()
    if (!query || query.length < 2 || query.length > 256) continue
    return {
      toolName: 'unified_browser',
      args: { action: 'search', query, browserMode: 'direct', description: 'auto-recovered unified browser search from prose narration' },
      matchedPattern: 'unified_browser.search',
    }
  }
  return null
}

function synthesizeUnifiedBrowser(content: string): NarrationRecovery | null {
  const m1 = content.match(UNIFIED_BROWSER_URL_RE)
  const m2 = content.match(UNIFIED_BROWSER_URL_RE_2)
  const m3 = content.match(UNIFIED_BROWSER_URL_RE_3)
  const url = (m1?.[1] || m2?.[1] || m3?.[1] || '').trim().replace(/[.,;:!?…]+$/g, '')
  if (!url || !/^https?:\/\//i.test(url)) return null
  return {
    toolName: 'unified_browser',
    args: { action: 'open', url, description: 'auto-recovered from prose narration' },
    matchedPattern: 'unified_browser.url',
  }
}

/**
 * Site → page-name → URL-shape catalog. Used by the page-name recovery
 * synthesizer below to turn prose like "open the dark pool flow page" into
 * a real `unified_browser action=open` call when the prior tool was on the
 * same site.
 *
 * Kept short on purpose: the goal is to recover the high-frequency
 * failure mode where the model says "I'll proceed to the X page" without
 * naming a URL, *not* to memorize every page on every site. Add to it
 * as new failure modes surface.
 */
const KNOWN_SITE_PAGES: ReadonlyArray<{
  site: RegExp
  pages: ReadonlyArray<{ name: RegExp; buildPath: (content: string) => string | null }>
}> = [
  {
    site: /^https?:\/\/(?:www\.)?whalestream\.com\//i,
    pages: [
      {
        name: /\b(?:the\s+)?top\s+options\s+(?:whale\s+)?flow(?:\s+page)?\b/i,
        buildPath: () => '/market-data/top-options-flow',
      },
      {
        name: /\b(?:the\s+)?(?:top\s+)?dark\s*pool(?:\s+(?:and|&)\s+(?:equit(?:y|ies)\s+)?(?:whale\s+)?flow)?(?:\s+(?:scanner|page))?\b/i,
        buildPath: () => '/market-data/top-dark-pool-flow',
      },
      {
        name: /\b(?:the\s+)?top\s+open\s+interest(?:\s+(?:changes|change|movements?))?\b/i,
        buildPath: () => '/market-data/top-open-interest',
      },
      {
        name: /\b(?:the\s+)?(?:news|ipo\s+calendar|earnings\s+calendar)(?:\s+(?:page|tab))?\b/i,
        buildPath: (content) => {
          if (/\bnews\b/i.test(content)) return '/market-data/news'
          if (/\bipo\s+calendar\b/i.test(content)) return '/market-data/ipo-calendar'
          if (/\b(?:earnings|quarterly\s+earnings)\s+calendar\b/i.test(content)) return '/market-data/earnings-calendar'
          return null
        },
      },
      {
        name: /\b(?:the\s+)?([A-Z]{1,5})\s+market\s+(?:activity\s+)?tracker\b/i,
        buildPath: (content) => {
          const m = content.match(/\b([A-Z]{1,5})\b/)
          return m ? `/market-tracker/${m[1].toUpperCase()}` : null
        },
      },
    ],
  },
  {
    site: /^https?:\/\/(?:www\.)?unusualwhales\.com\//i,
    pages: [
      {
        name: /\b(?:the\s+)?([A-Z]{1,5})\s+institutions?(?:\s+(?:page|tab))?\b/i,
        buildPath: (content) => {
          const m = content.match(/\b([A-Z]{1,5})\b/)
          return m ? `/stock/${m[1].toUpperCase()}/institutions` : null
        },
      },
      {
        name: /\b(?:the\s+)?([A-Z]{1,5})\s+overview\b/i,
        buildPath: (content) => {
          const m = content.match(/\b([A-Z]{1,5})\b/)
          return m ? `/stock/${m[1].toUpperCase()}/overview` : null
        },
      },
      {
        name: /\b(?:the\s+)?live\s+options\s+flow\b/i,
        buildPath: () => '/live-options-flow',
      },
      {
        name: /\b(?:the\s+)?dashboard\b/i,
        buildPath: () => '/dashboard',
      },
    ],
  },
  {
    site: /^https?:\/\/(?:html\.)?duckduckgo\.com\//i,
    pages: [
      {
        name: /\bsearch(?:\s+(?:results|page))?\s+for\s+["“”'`]([^"“”'`\n]+)["“”'`]/i,
        buildPath: (content) => {
          const m = content.match(/for\s+["“”'`]([^"“”'`\n]+)["“”'`]/i)
          return m ? `/?q=${encodeURIComponent(m[1].trim())}&ia=web` : null
        },
      },
    ],
  },
  {
    site: /^https?:\/\/(?:www\.)?holdingschannel\.com\//i,
    pages: [
      {
        name: /\b(?:the\s+)?([A-Z]{1,5})\s+institutional\s+(?:ownership|holders?)\b/i,
        buildPath: (content) => {
          const m = content.match(/\b([A-Z]{1,5})\b/)
          return m ? `/institutional/holders-of-${m[1].toLowerCase()}/` : null
        },
      },
    ],
  },
]

/**
 * Recover a `unified_browser action=open` call from prose that *names* a
 * page on the same site as the last successful tool. This is the safety
 * net for the failure mode where the model says "I'll proceed to the dark
 * pool flow page now" without ever emitting a URL.
 *
 * Requires the prior tool to be a `unified_browser` action with a `url`
 * field — we resolve the new URL against the prior URL's origin so this
 * cannot accidentally point at a different site. If the page name doesn't
 * match any known shape, or the prior tool isn't `unified_browser`, or
 * the prior URL is from a site we don't have a catalog for, returns null
 * and the runtime falls through to the existing recovery-nudge path.
 */
function synthesizeUnifiedBrowserByPageName(
  content: string,
  ctx: NarrationRecoveryContext,
): NarrationRecovery | null {
  if (!ctx.lastSuccessfulToolRequest) return null
  if (ctx.lastSuccessfulToolRequest.name !== 'unified_browser') return null
  const prev = ctx.lastSuccessfulToolRequest.request as { action?: string; url?: string } | undefined
  const prevUrl = prev?.url
  if (!prevUrl || typeof prevUrl !== 'string') return null

  for (const catalog of KNOWN_SITE_PAGES) {
    if (!catalog.site.test(prevUrl)) continue
    for (const page of catalog.pages) {
      if (!page.name.test(content)) continue
      const path = page.buildPath(content)
      if (!path) continue
      let resolved: string
      try {
        resolved = new URL(path, prevUrl).toString()
      } catch {
        continue
      }
      return {
        toolName: 'unified_browser',
        args: {
          action: 'open',
          url: resolved,
          description: 'auto-recovered page name from prose narration',
        },
        matchedPattern: 'unified_browser.pageName',
      }
    }
  }
  return null
}

function synthesizeTaxReturn(content: string): NarrationRecovery | null {
  const match = content.match(TAX_YEAR_RE)
  if (!match) return null
  const year = match[1]?.trim()
  if (!year || !/^\d{4}$/.test(year)) return null
  return {
    toolName: 'tax_return',
    args: { action: 'generate', taxYear: year },
    matchedPattern: 'tax_return.year',
  }
}

function synthesizeDocumentCreate(content: string): NarrationRecovery | null {
  for (const pattern of DOCUMENT_CREATE_RE_LIST) {
    const match = content.match(pattern)
    if (!match) continue
    const kindHint = (match[1] || '').toLowerCase()
    const toolName = DOCUMENT_CREATE_KIND_MAP[kindHint]
    if (!toolName) continue
    let title = ''
    const quoted = content.match(/["“”']([^"“”'\n]+)["“”']/)
    if (quoted) {
      title = quoted[1].trim()
    } else {
      const afterVerb = content.replace(/^[^a-zA-Z]+/, '').replace(/\n+/g, ' ').trim()
      const sentenceEnd = afterVerb.search(/[.!?]/)
      title = sentenceEnd > 0 ? afterVerb.slice(0, sentenceEnd).trim() : afterVerb.slice(0, 120).trim()
    }
    title = title.replace(/^(?:create|generate|build|make|render|produce|write)\s+/i, '').trim()
    if (!title || title.length > 200) title = 'Generated Document'
    return {
      toolName,
      args: { title, description: 'auto-recovered document creation from prose narration' },
      matchedPattern: 'document.create',
    }
  }
  return null
}

function synthesizeDocumentRegenerate(
  content: string,
  lastSuccessful: { name: string; request: unknown },
): NarrationRecovery | null {
  if (!REGENERATE_KEYWORDS.test(content)) return null
  if (!OPENCLAW_TOOL_NAME_SET.has(lastSuccessful.name)) return null

  // Re-submit the exact prior args. We don't transform them — the model
  // explicitly said "do it again" / "render the same thing". Safe by
  // construction because the prior call already passed validation.
  return {
    toolName: lastSuccessful.name,
    args: { __resubmit: lastSuccessful.request } as Record<string, unknown>,
    matchedPattern: 'document.regenerate',
  }
}

/**
 * Helper used by the runtime to convert a NarrationRecovery into an
 * OpenClawToolRequest suitable for the existing dispatcher. Pulled out so
 * the synthesizer itself stays a pure function and is trivial to test.
 */
export function buildOpenClawToolRequestFromNarration(
  recovery: NarrationRecovery,
): OpenClawToolRequest | null {
  if (!OPENCLAW_TOOL_NAME_SET.has(recovery.toolName)) return null

  if (recovery.toolName === 'filesystem') {
    const action = recovery.args.action as string
    const path = recovery.args.path as string
    if (action !== 'stat' && action !== 'read' && action !== 'list') return null
    if (typeof path !== 'string' || !path) return null
    return {
      name: 'filesystem',
      request: { action, path },
    }
  }

  if (recovery.toolName === 'shell') {
    const command = recovery.args.command as string
    if (typeof command !== 'string' || !command) return null
    return {
      name: 'shell',
      request: { command, description: (recovery.args.description as string) || '' },
    }
  }

  if (recovery.toolName === 'code') {
    const code = recovery.args.code as string
    const language = recovery.args.language as string
    if (typeof code !== 'string' || !code) return null
    const runtime = language === 'python' ? 'python' : 'node'
    return {
      name: 'code',
      request: {
        runtime,
        code,
        description: (recovery.args.description as string) || '',
      },
    }
  }

  if (recovery.toolName === 'web') {
    const query = recovery.args.query as string
    if (typeof query !== 'string' || !query) return null
    return {
      name: 'web',
      request: { query, description: (recovery.args.description as string) || '' },
    }
  }

  if (recovery.toolName === 'fetch_summarize') {
    const url = recovery.args.url as string
    if (typeof url !== 'string' || !url) return null
    return {
      name: 'fetch_summarize',
      request: { url, description: (recovery.args.description as string) || '' },
    }
  }

  if (recovery.toolName === 'unified_browser') {
    const url = recovery.args.url as string
    if (typeof url !== 'string' || !url) return null
    // The unified_browser action enum does NOT include 'navigate'; the
    // closest semantic match is `open` for navigation. Drop to `open` when
    // the synthesizer would otherwise emit an invalid value.
    return {
      name: 'unified_browser',
      request: {
        action: 'open',
        url,
        description: (recovery.args.description as string) || '',
      },
    }
  }

  if (recovery.toolName === 'tax_return') {
    const taxYear = recovery.args.taxYear as string
    if (typeof taxYear !== 'string' || !taxYear) return null
    // 'generate' is the narration-facing verb but the real enum is
    // 'generate_review_pdf' | 'fill_pdf_form'. Map to the former for the
    // common "generate a tax return" case; the latter would require a
    // template document id we don't have.
    return {
      name: 'tax_return',
      request: { action: 'generate_review_pdf', taxYear },
    }
  }

  // Document regeneration: the args contain a re-submission marker.
  if (recovery.matchedPattern === 'document.regenerate') {
    const resubmit = recovery.args.__resubmit as unknown
    if (resubmit && typeof resubmit === 'object') {
      return {
        name: recovery.toolName as OpenClawToolRequest['name'],
        request: resubmit as never,
      }
    }
    return null
  }

  return null
}
