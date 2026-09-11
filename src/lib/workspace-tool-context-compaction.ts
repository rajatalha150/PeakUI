/**
 * Within-turn tool-result compaction.
 *
 * The WorkSpaces agent loop resends the full `sessionHistory` to the model on
 * every round (`WorkspaceToolWorkspace.tsx` builds `conversationMessages` from it
 * each iteration). Tool results are stored as `role: 'user'` hidden messages
 * and can be large — up to `MAX_TEXT_CHARS_OPEN` (6000) chars each for page
 * extracts. On a long browsing/shell session the context grows ~10k+ chars
 * per round, and local models degrade in format adherence as the context
 * balloons — which is the root cause of the "tool calls get worse as the
 * session grows" failure mode.
 *
 * `trimMessagesToFit` only kicks in once the *whole* window overflows, and
 * when it does it evicts the oldest *messages* wholesale (losing early task
 * framing or mid-session findings). This module is a softer, tool-aware
 * pass that runs *before* the hard trim: it keeps the most recent tool
 * results in full and replaces the *bodies* of older tool results with a
 * compact stub that preserves the identifying metadata (header, command,
 * path, status, exit code, …) so the model still knows what ran and
 * whether it succeeded — it just no longer carries the exact bulky bytes
 * that it already saw when the tool ran.
 *
 * Pure and storage-agnostic: it returns a NEW array and never mutates the
 * input. The persisted chat history and the user-visible transcript are
 * untouched — only what is resent to the model on the next round changes.
 */

/**
 * Header prefix shared by every `format*ToolResult` builder in
 * `WorkspaceToolWorkspace.tsx`. A hidden `role: 'user'` message whose content
 * starts with one of these is a tool result, not a recovery nudge or a
 * duplicate-detection notice (those begin with "Your last message…" /
 * "The previous tool result…"). Keep this list in lockstep with the
 * formatters; the test suite asserts the symmetry.
 */
const TOOL_RESULT_HEADER_RE =
  /^(?:Shell command|Filesystem tool|Code execution|Web research tool|Browser tool|Tax return PDF tool|PDF document tool|Excel workbook tool|Word document tool|CSV export tool|Email writer tool|Markdown document tool|Slide deck tool|Archive tool|Calendar tool|Mermaid diagram tool|URL fetch and summarize tool|Image generation tool|Notes search tool|Notes save tool) result:/

export interface CompactableMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  hidden?: boolean
}

export interface CompactStaleToolResultsOptions {
  /**
   * Number of most-recent tool results to keep in full. Older tool results
   * are eligible for compaction. Default 4 — enough headroom for the model
   * to still cross-reference a few recent pages/commands while shedding the
   * long tail on extended browsing sessions.
   */
  keepRecent?: number
  /**
   * Only compact tool results whose content is at least this many chars.
   * Small results (errors, stat metadata, empty listings) are tiny and
   * carry no bulk to shed, so they are left untouched to preserve every
   * detail. Default 1500.
   */
  minCharsToCompact?: number
}

const DEFAULT_KEEP_RECENT = 4
const DEFAULT_MIN_CHARS_TO_COMPACT = 1500

/**
 * Maximum number of leading lines to retain from a compacted tool result.
 * Every formatter emits its metadata block (header + status/path/command/
 * exit/duration/…) in the first handful of lines, followed by a blank line
 * and then the bulky body (STDOUT, file content, directory entries, links,
 * page text). This cap is a safety bound; in practice the blank-line scan
 * below terminates well before it.
 */
const MAX_RETAINED_HEADER_LINES = 16

const COMPACTED_NOTE =
  '[… earlier tool result compacted to keep the context window lean for tool-call formatting. The metadata above is intact; the full body was already shown to you when the tool ran. If you still need the exact bytes, re-run the tool rather than guessing. …]'

export function isToolResultMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as CompactableMessage
  return m.role === 'user' && Boolean(m.hidden) && typeof m.content === 'string' && TOOL_RESULT_HEADER_RE.test(m.content)
}

/**
 * Build the compacted replacement content for a single tool-result message.
 * Keeps the metadata block (everything up to the first blank line that
 * precedes the bulky body), then appends the compaction note. If no blank
 * line is found (unexpected format), keeps the first `MAX_RETAINED_HEADER_LINES`
 * lines and then appends the note.
 */
export function compactToolResultContent(content: string): string {
  // Drop trailing empty lines first — a trailing newline must not be mistaken
  // for the blank line that separates the metadata block from the body.
  const lines = content.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  let cut = -1
  // The metadata block ends right before the first blank line — every
  // formatter pushes `''` then the body section ('STDOUT:', 'File content:',
  // 'Directory entries:', …). Require at least a couple of metadata lines so
  // a stray leading blank can't truncate the header itself.
  for (let i = 2; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      cut = i
      break
    }
  }
  if (cut === -1) cut = Math.min(lines.length, MAX_RETAINED_HEADER_LINES)
  const kept = lines.slice(0, cut)
  // Avoid a double blank line if the cut already landed on a trailing blank.
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  return `${kept.join('\n')}\n\n${COMPACTED_NOTE}`
}

/**
 * Return a new message array with stale tool-result bodies compacted.
 * Non-tool-result messages and recent tool results are reused by reference
 * (no clone); only the compacted entries are new objects. The input array
 * is never mutated.
 */
export function compactStaleToolResults<T extends CompactableMessage>(
  messages: ReadonlyArray<T>,
  options?: CompactStaleToolResultsOptions,
): T[] {
  const keepRecent = options?.keepRecent ?? DEFAULT_KEEP_RECENT
  const minCharsToCompact = options?.minCharsToCompact ?? DEFAULT_MIN_CHARS_TO_COMPACT

  // Indices of tool-result messages, in array order.
  const toolResultIndices: number[] = []
  for (let i = 0; i < messages.length; i += 1) {
    if (isToolResultMessage(messages[i])) toolResultIndices.push(i)
  }

  // The last `keepRecent` tool results stay full. Older ones whose content is
  // large enough to be worth compacting get a stub body.
  const keepFullCount = Math.min(keepRecent, toolResultIndices.length)
  const firstCompactableFromEnd = toolResultIndices.length - keepFullCount
  const compactThese = new Set<number>()
  for (let i = 0; i < firstCompactableFromEnd; i += 1) {
    const idx = toolResultIndices[i]
    if (messages[idx].content.length >= minCharsToCompact) compactThese.add(idx)
  }

  if (compactThese.size === 0) return [...messages]

  const result: T[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    if (compactThese.has(i)) {
      // Preserve every other field (id, role, hidden, createdAt, …) so the
      // resent array stays structurally identical to what the model expects.
      result.push({ ...msg, content: compactToolResultContent(msg.content) })
    } else {
      result.push(msg)
    }
  }
  return result
}

export const __test__ = {
  TOOL_RESULT_HEADER_RE,
  COMPACTED_NOTE,
  DEFAULT_KEEP_RECENT,
  DEFAULT_MIN_CHARS_TO_COMPACT,
}