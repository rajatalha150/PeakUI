/**
 * Workspace text search for the Coding surface.
 *
 * The daemon has no HTTP grep route — its ripgrep-based search is an agent
 * tool, not a client endpoint. The workbench search therefore composes two
 * client routes: `GET /glob?pattern=…` to enumerate candidate files, then
 * `GET /file` per candidate to grep its content. It is deliberately bounded
 * (the UI caps the candidate count and file size) because it is a convenience,
 * not the agent's search.
 *
 * This module owns the *pure* logic: validation of the glob payload and the
 * in-memory line search. Both are untrusted-input boundaries (glob matches
 * become `/file` paths; file content is grepped), so a malformed payload is
 * rejected and a match is never fabricated.
 */

/** A validated glob response. */
export interface GlobResult {
  matches: string[]
  count: number
  truncated: boolean
}

/** A single matching line in a searched file. */
export interface SearchHit {
  line: number
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse a `GET /glob` payload. */
export function parseGlobResult(data: unknown): { result: GlobResult } | { error: string } {
  if (!isRecord(data) || !Array.isArray(data.matches)) {
    return { error: 'Glob response is malformed.' }
  }
  if (!data.matches.every(m => typeof m === 'string')) {
    return { error: 'Glob response contains a non-string match.' }
  }
  return {
    result: {
      matches: data.matches as string[],
      count: typeof data.count === 'number' ? data.count : data.matches.length,
      truncated: data.truncated === true,
    },
  }
}

/**
 * Case-insensitive substring search over a file's lines, returning 1-based
 * line numbers and trimmed snippets. Bounded per file so one pathological
 * file cannot flood the result pane.
 */
export function searchLines(content: string, query: string, limit = 50): SearchHit[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  const hits: SearchHit[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length && hits.length < limit; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      hits.push({ line: i + 1, text: lines[i].trim() })
    }
  }
  return hits
}

/**
 * Join a workspace root and a workspace-relative glob match into the absolute
 * path the daemon's `/file` route expects. Skips the glob's `.` root entry.
 */
export function absoluteWorkspacePath(workspace: string, relative: string): string | null {
  if (!relative || relative === '.' || relative === './') return null
  const root = workspace.replace(/\/+$/, '')
  return `${root}/${relative.replace(/^\.\//, '')}`
}
