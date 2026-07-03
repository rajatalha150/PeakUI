import path from 'path'
import { promises as fs } from 'fs'
import os from 'os'

const DEFAULT_OPENCLAW_WORKSPACE_HOST_ROOT = path.join(os.homedir(), '.peakui', 'workspace')
const OPENCLAW_WORKSPACE_CONTAINER_ROOT = '/mnt/openclaw/workspace'
let workspaceAliasBootstrapPromise: Promise<void> | null = null

export function normalizeHostPath(input: string): string {
  let trimmed = input.trim().replace(/\\\\/g, '/').replace(/\/+$/, '')
  // Expand leading '~' to the user's home directory before any other resolution.
  if (trimmed.startsWith('~/')) {
    trimmed = path.join(os.homedir(), trimmed.slice(2))
  }
  // Preserve Windows absolute paths (e.g. C:/Users/John/peakui-workspace) as-is.
  // Linux path.resolve would treat them as relative and corrupt the drive letter.
  if (/^[A-Za-z]:\//.test(trimmed)) {
    return trimmed
  }
  return path.resolve(trimmed)
}

export function getOpenClawWorkspaceHostRoot(): string {
  return normalizeHostPath(
    process.env.OPENCLAW_HOST_WORKSPACE_DIR || DEFAULT_OPENCLAW_WORKSPACE_HOST_ROOT
  )
}

export function getOpenClawWorkspaceContainerRoot(): string {
  return OPENCLAW_WORKSPACE_CONTAINER_ROOT
}

export function getOpenClawWorkspaceLabel(): string {
  return `${getOpenClawWorkspaceHostRoot()} (mounted at ${OPENCLAW_WORKSPACE_CONTAINER_ROOT})`
}

export function isWindowsHostPath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value.replace(/\\/g, '/'))
}

async function ensureWorkspaceAliasExists(): Promise<void> {
  const containerRoot = getOpenClawWorkspaceContainerRoot()
  const hostAliasPath = getOpenClawWorkspaceHostRoot()

  await fs.mkdir(containerRoot, { recursive: true })

  // Default to the container root itself if the configured host root is just the
  // container path. Otherwise, try to use the configured value as-is when it is
  // already an absolute Linux path pointing inside the container (e.g. a bind
  // mount is mounted at a custom host path).
  if (hostAliasPath === containerRoot) {
    return
  }

  // On Windows Docker Desktop the host path is a drive letter (C:/...). The
  // workspace is already bind-mounted into the container, so no alias is needed.
  if (/^[A-Za-z]:\//.test(hostAliasPath)) {
    return
  }

  // When the configured host root already resolves to the same real directory as
  // the container root (e.g. the user bind-mounted a real host directory directly
  // at /mnt/openclaw/workspace), no extra symlink alias is required.
  const resolvedHostRoot = path.resolve(hostAliasPath)
  if (resolvedHostRoot === containerRoot) {
    return
  }

  await fs.mkdir(path.dirname(hostAliasPath), { recursive: true })

  try {
    const existingStats = await fs.lstat(hostAliasPath)
    if (existingStats.isSymbolicLink()) {
      const linkedTarget = await fs.readlink(hostAliasPath)
      const resolvedLinkedTarget = path.resolve(path.dirname(hostAliasPath), linkedTarget)
      if (resolvedLinkedTarget === containerRoot) {
        return
      }
    }

    const [existingRealPath, containerRealPath] = await Promise.all([
      fs.realpath(hostAliasPath).catch(() => null),
      fs.realpath(containerRoot).catch(() => null),
    ])

    if (existingRealPath && containerRealPath && existingRealPath === containerRealPath) {
      return
    }

    // A different file or directory already exists at the alias path. Leave it alone.
    return
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ENOENT') {
      throw error
    }
  }

  try {
    await fs.symlink(containerRoot, hostAliasPath)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'EEXIST') {
      throw error
    }
  }
}

export async function ensureOpenClawWorkspaceAlias(): Promise<void> {
  if (!workspaceAliasBootstrapPromise) {
    workspaceAliasBootstrapPromise = ensureWorkspaceAliasExists().catch(error => {
      workspaceAliasBootstrapPromise = null
      throw error
    })
  }

  await workspaceAliasBootstrapPromise
}

export function getUwafClearWebDir(): string {
  return path.join(getOpenClawWorkspaceHostRoot(), 'research', 'clear_web')
}

export function getUwafDarkWebDir(): string {
  return path.join(getOpenClawWorkspaceHostRoot(), 'research', 'dark_web')
}

export async function ensureUwafDirectories(): Promise<void> {
  const dirs = [
    getUwafClearWebDir(),
    getUwafDarkWebDir(),
  ]
  await Promise.all(dirs.map(dir => fs.mkdir(dir, { recursive: true })))
}

/**
 * Shape of a single search result the user wants persisted. Mirrors
 * the fields the runtime has at the moment it writes the note.
 */
export interface DarkWebSearchNoteEntry {
  /** ISO timestamp of the search. */
  searchedAt: string
  /** Browser mode used. */
  mode: 'direct' | 'stealth'
  /** Stealth profile, if mode === 'stealth'. */
  stealthProfile?: 'normal' | 'high'
  /** Search provider that returned the result, or 'unknown' on full failure. */
  providerId: string
  providerLabel: string
  /** Number of result rows the parser surfaced (after dedup). */
  resultCount: number
  /** Wall-clock latency of the search in milliseconds. */
  durationMs?: number
  /** The original query string. */
  query: string
  /** Top surviving result rows, in display order. */
  topResults: Array<{
    url: string
    title: string
    snippet: string
    category: string
  }>
  /** Whether the search succeeded. Partial-failure runs are still written. */
  success: boolean
  /** Failure code, if any. */
  failureCode?: string
}

const DARK_WEB_NOTES_HEADER = '# Dark Web Searches\n\nA chronological log of stealth-mode searches run from this workspace. Each entry includes the query, the provider used, the top surviving results, and a link to the live session.\n\n'

/**
 * Append a single search entry to the dark-web-searches.md note in the
 * host workspace. Best-effort: filesystem failures (EACCES, ENOENT, …)
 * are returned as `{ ok: false, error }` so the caller can log to
 * telemetry without aborting the search.
 *
 * The note is append-only: existing content is preserved. If the file
 * does not exist yet, it is created with a short header explaining the
 * format. The writer is intentionally sequential (read existing → append
 * → write) so concurrent searches serialise cleanly without us needing
 * a per-process lock.
 */
export async function recordDarkWebSearchNote(
  entry: DarkWebSearchNoteEntry,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const notePath = path.join(getUwafDarkWebDir(), 'dark-web-searches.md')
  try {
    await ensureUwafDirectories()
    let existing = ''
    try {
      existing = await fs.readFile(notePath, 'utf8')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? (error as NodeJS.ErrnoException).code : null
      if (code !== 'ENOENT') throw error
    }
    const section = formatDarkWebSearchSection(entry)
    const next = existing ? `${existing.trimEnd()}\n\n${section}\n` : `${DARK_WEB_NOTES_HEADER}${section}\n`
    await fs.writeFile(notePath, next, 'utf8')
    return { ok: true, path: notePath }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Render a single search entry as a markdown section. Exposed via
 * `__test__` so the format can be locked in by a unit test.
 */
export function formatDarkWebSearchSection(entry: DarkWebSearchNoteEntry): string {
  const ts = entry.searchedAt || new Date().toISOString()
  const modeTag = entry.mode === 'stealth'
    ? `stealth${entry.stealthProfile ? ` (${entry.stealthProfile})` : ''}`
    : 'direct'
  const statusTag = entry.success
    ? `${entry.resultCount} results`
    : `failed${entry.failureCode ? ` · ${entry.failureCode}` : ''}`
  const durationTag = typeof entry.durationMs === 'number'
    ? ` · ${(entry.durationMs / 1000).toFixed(1)}s`
    : ''
  const headerParts = [ts, modeTag, entry.providerLabel, statusTag + durationTag]
  const lines: string[] = []
  lines.push(`## ${headerParts.join(' · ')}`)
  lines.push('')
  lines.push(`**Query:** \`${entry.query.replace(/`/g, '\\`')}\``)
  if (entry.topResults.length > 0) {
    lines.push('')
    for (const result of entry.topResults) {
      const snippet = result.snippet ? ` — ${result.snippet.slice(0, 200)}` : ''
      const category = result.category ? ` _[${result.category}]_` : ''
      lines.push(`${entry.topResults.indexOf(result) + 1}. [${result.title}](${result.url})${category}${snippet}`)
    }
  } else if (!entry.success) {
    lines.push('')
    lines.push('_No rows survived dedup — all approved providers returned zero results for this query._')
  }
  return lines.join('\n')
}

export const __test__ = {
  DARK_WEB_NOTES_HEADER,
  formatDarkWebSearchSection,
}
