/**
 * Untrusted tool-output wrapping — a prompt-injection defense for WorkSpaces.
 *
 * Tool results (web SERPs, browser page text, shell STDOUT, fetch quotes)
 * are attacker- or page-influenced text that gets inserted verbatim into the
 * model's message history. A malicious page can contain "Ignore previous
 * instructions…" prose, a forged `</untrusted_tool_result>` delimiter, a fake
 * `<workspace_tool>` tag, or a `<system>` marker — and a local model reading
 * that text on the next turn can be tricked into obeying it. The observed
 * "the agent abandoned the objective and switched topics" failure is a mild
 * version of this: salient tokens from a noisy SERP ("block this site",
 * "bypass", "access") bled into the model's goal.
 *
 * Wrapping is a 20-line defense: defang the literal delimiter/injection
 * markers inside the external content, then fence it with an explicit
 * `<untrusted_tool_result source="…">…</untrusted_tool_result>` boundary so
 * the model knows this block is tool output, not instructions.
 *
 * Integration contract (compaction-safe):
 *   Formatters push a trusted label (e.g. "Public web context:", "STDOUT:")
 *   and then push `wrapUntrustedToolResult(source, body)` as the value. The
 *   wrapped block lives in the body region that `compactStaleToolResults`
 *   discards for old results, so a compacted stub never leaves an unbalanced
 *   opening tag. Our own trailing instructions and structured link/form lists
 *   stay OUTSIDE the wrap.
 */

/** Opening delimiter. The source attribute names the tool that produced it. */
export const UNTRUSTED_RESULT_OPEN = (source: string): string =>
  `<untrusted_tool_result source="${source}">`

/** Closing delimiter. */
export const UNTRUSTED_RESULT_CLOSE = '</untrusted_tool_result>'

/**
 * Defang the literal substrings an attacker could embed in external text to
 * forge a delimiter, a fake tool call, or a system-message marker. Each is
 * neutralized to a visually-similar but inert form so the model still reads
 * the content naturally while none of the magic tokens survive verbatim.
 *
 * Case-insensitive: an attacker writes `</UNTRUSTED_TOOL_RESULT>` or
 * `<System>` to evade a case-sensitive replace.
 */
export function neutralizeUntrustedDelimiters(content: string): string {
  return content
    .replace(/untrusted_tool_result/gi, 'untrusted_tool_result_')
    .replace(/###instruction###/gi, '###.instruction.###')
    // Match the whole tag (including its closing `>`) so the brackets are
    // fully neutralized; otherwise a trailing `>` would survive and leave a
    // half-defanged marker. Names are defanged too so a forged tag cannot
    // be reassembled even if the model echoes the bracketed form.
    .replace(/<\/?workspace_tool\b[^>]*>/gi, (match) =>
      match.replace(/</g, '[').replace(/>/g, ']').replace(/workspace_tool/gi, 'workspace_tool_'),
    )
    .replace(/<\/?system\b[^>]*>/gi, (match) => match.replace(/</g, '[').replace(/>/g, ']'))
}

/**
 * Wrap external (untrusted) tool-output body in a clearly-delimited, defanged
 * block. Empty/whitespace-only content is returned as-is so formatters don't
 * emit an empty wrapper.
 *
 * The returned string is ONLY the wrapped block — the caller is responsible
 * for the trusted label that precedes it (e.g. `STDOUT:`).
 */
export function wrapUntrustedToolResult(source: string, content: string): string {
  const body = (content || '').trim()
  if (!body) return content
  const defanged = neutralizeUntrustedDelimiters(body)
  return `${UNTRUSTED_RESULT_OPEN(source)}\n${defanged}\n${UNTRUSTED_RESULT_CLOSE}`
}