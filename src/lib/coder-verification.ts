/**
 * Verification records for the Coding surface (Phase 5: reversible work and
 * verification evidence).
 *
 * A verification record is a *structured* trace of a check the human ran (a
 * named task over the daemon shell, a test run, …): what ran, where, how it
 * exited, when, and the workspace fingerprint it was measured against. It is
 * deliberately separate from the raw task output log — the record is what lets
 * the UI say "this passed, against this content, and it is now stale" rather
 * than just dumping a terminal scrollback.
 *
 * We cannot cheaply produce a full-tree content fingerprint (the daemon exposes
 * per-file hashes, not a workspace tree hash), so the fingerprint is a
 * conservative *workspace mutation counter*: every file mutation — a human save
 * through the explorer, or an agent tool call that can mutate the workspace —
 * advances it. A record is stale iff the counter has moved past the value it was
 * captured at. The mutating-tool predicate is default-deny (anything that is not
 * a known read-only tool counts as mutating), so stale-marking can only
 * over-approximate and never under-approximate — an edit can never leave prior
 * evidence looking fresh.
 *
 * This module owns the *pure* logic; `CodingView` holds the records and the
 * derived counter.
 */

/** A known read-only tool: these never touch workspace content. */
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'glob',
  'grep',
  'search',
  'web_search',
  'web_fetch',
  'zoom_image',
  'view_image',
  'todo_write',
  'stat',
  'read',
])

/**
 * Whether a tool call may have mutated the workspace. Unknown/absent tool names
 * are treated as mutating so stale-marking over-approximates instead of missing
 * an edit (the spec's failure mode is an edit that leaves old evidence "fresh").
 */
export function isMutatingTool(toolName: string | undefined): boolean {
  if (!toolName) return true
  return !READ_ONLY_TOOLS.has(toolName)
}

/** A single completed verification run. */
export interface VerificationRecord {
  id: string
  command: string
  cwd: string
  exitCode: number | null
  startedAt: number
  finishedAt: number
  output: string
  /** Workspace mutation counter captured when the run started. */
  mutation: number
}

/**
 * True when the workspace has changed since the record was captured — i.e. the
 * record's exit status/output may no longer describe the current content.
 */
export function isVerificationStale(record: VerificationRecord, currentMutation: number): boolean {
  return currentMutation > record.mutation
}

/** Build a verification record from a completed shell run. */
export function buildVerificationRecord(input: {
  id: string
  command: string
  cwd: string
  exitCode: number | null
  startedAt: number
  output: string
  mutation: number
  finishedAt?: number
}): VerificationRecord {
  return {
    id: input.id,
    command: input.command,
    cwd: input.cwd,
    exitCode: input.exitCode,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt ?? Date.now(),
    output: input.output,
    mutation: input.mutation,
  }
}
