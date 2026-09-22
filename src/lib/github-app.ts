import { SignJWT, importPKCS8 } from 'jose'

const API_URL = 'https://api.github.com'

export interface GitHubInstallation {
  id: number
  account?: { login?: string; type?: string }
}

export interface GitHubRepository {
  id: number
  full_name: string
  name: string
  private: boolean
  default_branch: string
  clone_url: string
  archived: boolean
  disabled: boolean
}

function env(name: string) {
  return (process.env[name] || '').trim()
}

function privateKey() {
  return env('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n')
}

export function githubAppConfiguration() {
  const appId = env('GITHUB_APP_ID')
  const slug = env('GITHUB_APP_SLUG')
  return {
    configured: Boolean(appId && slug && privateKey()),
    appId,
    slug,
  }
}

function apiHeaders(token: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PeakUI-GitHub-App',
  }
}

async function appJwt() {
  const config = githubAppConfiguration()
  if (!config.configured) throw new Error('GitHub integration is not configured on this deployment.')
  const key = await importPKCS8(privateKey(), 'RS256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.appId)
    .setIssuedAt()
    .setExpirationTime('9m')
    .sign(key)
}

async function githubJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...apiHeaders(token), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `GitHub API request failed (${response.status}).`)
  return data
}

export async function getGitHubInstallation(installationId: string): Promise<GitHubInstallation> {
  if (!/^\d+$/.test(installationId)) throw new Error('Invalid GitHub installation.')
  return githubJson<GitHubInstallation>(`/app/installations/${installationId}`, await appJwt())
}

async function installationToken(installationId: string, repositoryId?: string) {
  const body = repositoryId && /^\d+$/.test(repositoryId) ? JSON.stringify({ repository_ids: [Number(repositoryId)] }) : undefined
  const result = await githubJson<{ token?: string }>(`/app/installations/${installationId}/access_tokens`, await appJwt(), {
    method: 'POST', ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}),
  })
  if (!result.token) throw new Error('GitHub did not return an installation token.')
  return result.token
}

export async function listGitHubRepositories(installationId: string): Promise<GitHubRepository[]> {
  const token = await installationToken(installationId)
  const repositories: GitHubRepository[] = []
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubJson<{ repositories?: GitHubRepository[] }>(`/installation/repositories?per_page=100&page=${page}`, token)
    const batch = Array.isArray(result.repositories) ? result.repositories : []
    repositories.push(...batch)
    if (batch.length < 100) break
  }
  return repositories.filter(repo => !repo.archived && !repo.disabled && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repo.clone_url))
}

export async function getGitHubCloneHeader(installationId: string, repositoryId: string) {
  const token = await installationToken(installationId, repositoryId)
  return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
}
