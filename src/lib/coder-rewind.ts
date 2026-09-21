/**
 * Reversible-work (rewind) contract for the Coding surface.
 *
 * The daemon keeps a file-history service per session and exposes two HTTP
 * routes for reversible work:
 *
 *   - `GET  /session/:id/rewind/snapshots` → `{ snapshots: RewindSnapshot[] }`
 *     one entry per rewindable user turn, each carrying a `promptId` that is
 *     the opaque rewind target and a `diffStats` summary of what that turn
 *     changed on disk.
 *   - `POST /session/:id/rewind` with `{ promptId, rewindFiles }` → rewinds the
 *     conversation AND (when `rewindFiles` is true, the default) restores the
 *     workspace files to that snapshot, answering with
 *     `{ rewound, targetTurnIndex, filesChanged, filesFailed }`.
 *
 * This module owns the *pure* parsing/validation of those payloads. The daemon
 * is a separate process on the other side of the gateway, so its responses are
 * untrusted: a malformed snapshot list or rewind result is rejected here before
 * the UI renders it or a `promptId` is echoed back as a rewind target.
 */

/** Per-snapshot diff summary the daemon reports for a turn. */
export interface RewindDiffStats {
  /** Number of files the turn changed (length of the changed-file list). */
  filesChanged: number
  insertions: number
  deletions: number
}

/** One rewindable user turn. */
export interface RewindSnapshot {
  /** Opaque rewind target — echoed back verbatim to `POST …/rewind`. */
  promptId: string
  /** 0-based user-turn index. */
  turnIndex: number
  /** ISO-8601 timestamp of the snapshot. */
  timestamp: string
  diffStats: RewindDiffStats
}

/** Successful rewind result. */
export interface RewindResult {
  /** False when any file restore failed. */
  rewound: boolean
  /** Turn index the conversation was rewound to. */
  targetTurnIndex: number
  /** Workspace files the rewind changed. */
  filesChanged: string[]
  /** Workspace files whose restore failed. */
  filesFailed: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function parseDiffStats(value: unknown): RewindDiffStats | null {
  if (!isRecord(value)) return null
  // The daemon always sends all three; coerce with defaults so a future field
  // addition does not turn a valid snapshot into an error.
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    filesChanged: Math.max(0, num(value.filesChanged)),
    insertions: Math.max(0, num(value.insertions)),
    deletions: Math.max(0, num(value.deletions)),
  }
}

function parseSnapshot(value: unknown): RewindSnapshot | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.promptId)) return null
  if (!isNonNegativeInteger(value.turnIndex)) return null
  if (typeof value.timestamp !== 'string') return null
  const diffStats = parseDiffStats(value.diffStats)
  if (!diffStats) return null
  return {
    promptId: value.promptId,
    turnIndex: value.turnIndex,
    timestamp: value.timestamp,
    diffStats,
  }
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every(v => typeof v === 'string')) return null
  return value as string[]
}

/**
 * Parse a `GET /session/:id/rewind/snapshots` payload. Rejects a malformed list
 * rather than rendering it, so a daemon bug or a non-daemon response can never
 * drive the UI into echoing a bogus `promptId`.
 */
export function parseRewindSnapshots(
  data: unknown,
): { snapshots: RewindSnapshot[] } | { error: string } {
  if (!isRecord(data) || !Array.isArray(data.snapshots)) {
    return { error: 'Rewind snapshots response is malformed.' }
  }
  const snapshots: RewindSnapshot[] = []
  for (const raw of data.snapshots) {
    const parsed = parseSnapshot(raw)
    if (!parsed) return { error: 'Rewind snapshots response contains an invalid snapshot.' }
    snapshots.push(parsed)
  }
  return { snapshots }
}

/**
 * Parse a `POST /session/:id/rewind` payload. Rejects a malformed result so a
 * failure (or a non-daemon answer) is surfaced as an error, not as an empty
 * "nothing changed" result.
 */
export function parseRewindResult(
  data: unknown,
): { result: RewindResult } | { error: string } {
  if (!isRecord(data)) return { error: 'Rewind response is malformed.' }
  if (typeof data.rewound !== 'boolean') return { error: 'Rewind response is missing a result.' }
  if (!isNonNegativeInteger(data.targetTurnIndex)) {
    return { error: 'Rewind response is missing the target turn.' }
  }
  const filesChanged = parseStringArray(data.filesChanged)
  const filesFailed = parseStringArray(data.filesFailed)
  if (!filesChanged || !filesFailed) {
    return { error: 'Rewind response is missing the changed-file list.' }
  }
  return {
    result: {
      rewound: data.rewound,
      targetTurnIndex: data.targetTurnIndex,
      filesChanged,
      filesFailed,
    },
  }
}
