import path from 'path'
import { promises as fs } from 'fs'

const DEFAULT_OPENCLAW_WORKSPACE_HOST_ROOT = '/tmp/viewllama-openclaw-workspace'
const OPENCLAW_WORKSPACE_CONTAINER_ROOT = '/mnt/openclaw/workspace'
let workspaceAliasBootstrapPromise: Promise<void> | null = null

function normalizeAbsolutePath(input: string): string {
  return path.resolve(input.trim())
}

export function getOpenClawWorkspaceHostRoot(): string {
  return normalizeAbsolutePath(
    process.env.OPENCLAW_HOST_WORKSPACE_DIR || DEFAULT_OPENCLAW_WORKSPACE_HOST_ROOT
  )
}

export function getOpenClawWorkspaceContainerRoot(): string {
  return OPENCLAW_WORKSPACE_CONTAINER_ROOT
}

export function getOpenClawWorkspaceLabel(): string {
  return `${getOpenClawWorkspaceHostRoot()} (mounted at ${OPENCLAW_WORKSPACE_CONTAINER_ROOT})`
}

async function ensureWorkspaceAliasExists(): Promise<void> {
  const containerRoot = getOpenClawWorkspaceContainerRoot()
  const hostAliasPath = getOpenClawWorkspaceHostRoot()

  await fs.mkdir(containerRoot, { recursive: true })

  if (hostAliasPath === containerRoot) {
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
  return path.join(OPENCLAW_WORKSPACE_CONTAINER_ROOT, 'research', 'clear_web')
}

export function getUwafDarkWebDir(): string {
  return path.join(OPENCLAW_WORKSPACE_CONTAINER_ROOT, 'research', 'dark_web')
}

export async function ensureUwafDirectories(): Promise<void> {
  const dirs = [
    getUwafClearWebDir(),
    getUwafDarkWebDir(),
  ]
  await Promise.all(dirs.map(dir => fs.mkdir(dir, { recursive: true })))
}
