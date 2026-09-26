import { execFile } from 'node:child_process'
import { mkdir, lstat, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from './prisma'
import { proxyToCoderDaemon } from './coder-gateway'
import { getGitHubCloneHeader, listGitHubRepositories, type GitHubRepository } from './github-app'

const execFileAsync = promisify(execFile)
const CODER_WORKSPACE_ROOT = '/workspace/projects'
const APP_PROJECT_ROOT = process.env.CODER_PROJECTS_HOST_ROOT || '/coder-workspace/projects'

export function isSafeGitBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value)
    && !value.includes('..') && !value.endsWith('/') && !value.endsWith('.') && !value.includes('@{')
}

function appProjectPath(id: string) {
  const root = resolve(APP_PROJECT_ROOT)
  const target = resolve(root, id)
  if (!target.startsWith(`${root}/`)) throw new Error('Invalid project path.')
  return target
}

export async function listProjectsForUser(userId: string) {
  return prisma.coderProject.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, provider: true, repositoryFullName: true, defaultBranch: true, branch: true, workspacePath: true, createdAt: true, updatedAt: true },
  })
}

export async function repositoriesForConnection(userId: string) {
  const connection = await prisma.gitHubConnection.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  if (!connection) throw new Error('Connect GitHub before importing a repository.')
  const repositories = await listGitHubRepositories(connection.installationId)
  return { connection, repositories }
}

export async function importGitHubProject(userId: string, repositoryId: string, branch?: string) {
  if (!/^\d+$/.test(repositoryId)) throw new Error('Invalid repository selection.')
  const { connection, repositories } = await repositoriesForConnection(userId)
  const repository = repositories.find(repo => String(repo.id) === repositoryId)
  if (!repository) throw new Error('That repository is not available to this GitHub connection.')
  const selectedBranch = branch?.trim() || repository.default_branch
  if (!isSafeGitBranch(selectedBranch)) throw new Error('Invalid branch name.')

  const existing = await prisma.coderProject.findUnique({
    where: { userId_provider_repositoryId_branch: { userId, provider: 'github', repositoryId, branch: selectedBranch } },
  })
  if (existing) return existing

  const id = randomUUID()
  const destination = appProjectPath(id)
  const workspacePath = `${CODER_WORKSPACE_ROOT}/${id}`
  const remoteImport = process.env.CODER_BACKEND === 'lxd'
  if (!remoteImport) {
    await mkdir(resolve(APP_PROJECT_ROOT), { recursive: true, mode: 0o700 })
    try {
      await lstat(destination)
      throw new Error('Project destination already exists.')
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  const cloneHeader = await getGitHubCloneHeader(connection.installationId, repositoryId)
  try {
    if (remoteImport) {
      const imported = await proxyToCoderDaemon('/peakui/projects/import', {
        method: 'POST', timeoutMs: 180_000,
        body: { repositoryUrl: repository.clone_url, branch: selectedBranch, destination: workspacePath, authHeader: cloneHeader },
      })
      if (!imported.ok) {
        const detail = (() => { try { return JSON.parse(imported.body).error as string } catch { return '' } })()
        throw new Error(detail || 'Coder could not clone the repository.')
      }
    } else {
      await execFileAsync('git', ['clone', '--depth=1', '--branch', selectedBranch, '--', repository.clone_url, destination], {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_ALLOW_PROTOCOL: 'https', GIT_PROTOCOL_FROM_USER: '0',
          GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: cloneHeader,
        },
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      })
    }
    return await prisma.coderProject.create({
      data: {
        id, userId, githubConnectionId: connection.id, provider: 'github', repositoryId,
        repositoryFullName: repository.full_name, defaultBranch: repository.default_branch,
        branch: selectedBranch, workspacePath,
      },
    })
  } catch (error) {
    if (!remoteImport) await rm(destination, { recursive: true, force: true }).catch(() => {})
    throw new Error(error instanceof Error ? `Could not clone ${repository.full_name}: ${error.message.replace(/https?:\/\/[^\s]+/g, '[repository URL]')}` : 'Could not clone repository.')
  }
}

export type { GitHubRepository }
