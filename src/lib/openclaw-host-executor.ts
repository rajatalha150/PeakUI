import type { ShellCommandResult } from './shell-execution'

const DEFAULT_HOST_EXECUTOR_URL = 'http://127.0.0.1:4318'
const DEFAULT_CONNECT_TIMEOUT_MS = 4000

export interface HostExecutorStatus {
  configured: boolean
  reachable: boolean
  url: string
  error?: string
}

export interface HostShellExecutionRequest {
  command: string
  cwd?: string
  timeoutMs: number
  maxOutputBytes: number
  allowedRoots: string[]
  allowedEnvNames: string[]
}

function getHostExecutorUrl(): string {
  const raw = process.env.OPENCLAW_HOST_EXECUTOR_URL?.trim()
  return raw || DEFAULT_HOST_EXECUTOR_URL
}

function getHostExecutorToken(): string {
  return process.env.OPENCLAW_HOST_EXECUTOR_TOKEN?.trim() || ''
}

async function fetchHostExecutor(pathname: string, init?: RequestInit): Promise<Response> {
  const token = getHostExecutorToken()
  if (!token) {
    throw new Error('Host executor token is not configured.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_CONNECT_TIMEOUT_MS)

  try {
    return await fetch(`${getHostExecutorUrl()}${pathname}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getHostExecutorStatus(): Promise<HostExecutorStatus> {
  const url = getHostExecutorUrl()
  const token = getHostExecutorToken()
  if (!token) {
    return {
      configured: false,
      reachable: false,
      url,
      error: 'OPENCLAW_HOST_EXECUTOR_TOKEN is not configured.',
    }
  }

  try {
    const response = await fetchHostExecutor('/health', { method: 'GET' })
    if (!response.ok) {
      const text = await response.text()
      return {
        configured: true,
        reachable: false,
        url,
        error: text || `Host executor returned ${response.status}.`,
      }
    }

    return {
      configured: true,
      reachable: true,
      url,
    }
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      url,
      error: error instanceof Error ? error.message : 'Failed to reach host executor.',
    }
  }
}

export async function executeHostCommand(request: HostShellExecutionRequest): Promise<ShellCommandResult> {
  const response = await fetchHostExecutor('/execute', {
    method: 'POST',
    body: JSON.stringify(request),
  })

  const data = await response.json().catch(() => ({})) as Partial<ShellCommandResult> & { error?: string }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Host executor returned ${response.status}.`)
  }

  return {
    success: Boolean(data.success),
    stdout: typeof data.stdout === 'string' ? data.stdout : '',
    stderr: typeof data.stderr === 'string' ? data.stderr : '',
    exitCode: typeof data.exitCode === 'number' ? data.exitCode : data.exitCode === null ? null : null,
    duration: typeof data.duration === 'number' ? data.duration : 0,
    command: typeof data.command === 'string' ? data.command : request.command,
    target: 'host',
  }
}
