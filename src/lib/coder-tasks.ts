/**
 * Named project tasks for the Coding surface.
 *
 * The workbench exposes four standard tasks — install / build / test / run —
 * each a single shell command executed through the daemon's
 * `POST /session/:id/shell` route (the same on-demand shell the terminal
 * pop-up uses). The command defaults are derived from the project's package
 * manager, detected from the lockfile in the workspace root, so a pnpm project
 * is not handed `npm install`.
 *
 * This module owns the pure logic (lockfile → package manager → defaults, plus
 * validation of the daemon's shell response). The shell response is untrusted
 * (a separate process behind the gateway), so a malformed payload is rejected
 * rather than rendered as "succeeded with no output".
 */

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

/** A named task the workbench can run. */
export interface Task {
  id: string
  label: string
  command: string
}

const LOCKFILE_BY_MANAGER: Array<[PackageManager, string[]]> = [
  ['pnpm', ['pnpm-lock.yaml']],
  ['yarn', ['yarn.lock']],
  ['bun', ['bun.lockb', 'bun.lock']],
  ['npm', ['package-lock.json']],
]

/**
 * Detect the package manager from the workspace-root listing (lockfile names).
 * Defaults to `npm` when no lockfile is present — the least-surprising choice
 * for a project that has not been installed yet.
 */
export function detectPackageManager(files: string[]): PackageManager {
  const names = new Set(files)
  for (const [pm, lockfiles] of LOCKFILE_BY_MANAGER) {
    if (lockfiles.some(lock => names.has(lock))) return pm
  }
  return 'npm'
}

const COMMANDS: Record<Task['id'], Record<PackageManager, string>> = {
  install: { npm: 'npm install', yarn: 'yarn install', pnpm: 'pnpm install', bun: 'bun install' },
  build: { npm: 'npm run build', yarn: 'yarn build', pnpm: 'pnpm build', bun: 'bun run build' },
  test: { npm: 'npm test', yarn: 'yarn test', pnpm: 'pnpm test', bun: 'bun test' },
  run: { npm: 'npm run dev', yarn: 'yarn dev', pnpm: 'pnpm dev', bun: 'bun run dev' },
}

const LABELS: Record<Task['id'], string> = {
  install: 'Install',
  build: 'Build',
  test: 'Test',
  run: 'Run',
}

/** The four named tasks with commands for the given package manager. */
export function buildDefaultTasks(pm: PackageManager): Task[] {
  return (['install', 'build', 'test', 'run'] as const).map(id => ({
    id,
    label: LABELS[id],
    command: COMMANDS[id][pm],
  }))
}

/** A validated daemon shell result. */
export interface ShellResult {
  output: string
  exitCode: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a `POST /session/:id/shell` success payload. `exitCode` is null when
 * the daemon did not report one (e.g. the command was aborted); output defaults
 * to an empty string when absent.
 */
export function parseShellResult(data: unknown): { result: ShellResult } | { error: string } {
  if (!isRecord(data)) return { error: 'Shell response is malformed.' }
  return {
    result: {
      output: typeof data.output === 'string' ? data.output : '',
      exitCode: typeof data.exitCode === 'number' ? data.exitCode : null,
    },
  }
}
