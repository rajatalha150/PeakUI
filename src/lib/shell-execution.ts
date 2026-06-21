/**
 * Shell Execution Library for WorkSpaces
 *
 * Provides safe command execution with approval gates and output capture.
 */

import { exec } from 'child_process'
import { createHmac, timingSafeEqual } from 'crypto'
import path from 'path'
import { promisify } from 'util'
import { getJwtSecret } from './auth'
import {
  ensureOpenClawWorkspaceAlias,
  getOpenClawWorkspaceContainerRoot,
  getOpenClawWorkspaceHostRoot,
  isWindowsHostPath,
} from './openclaw-workspace'

const execAsync = promisify(exec)
const APPROVAL_TTL_MS = 10 * 60 * 1000

export type ShellExecutionMode = 'auto-approve' | 'ask-first' | 'deny'
export type ShellExecutionTarget = 'container' | 'host'

export interface ShellCommandRequest {
  command: string
  cwd?: string
  timeout?: number
  description?: string
}

export interface ShellCommandResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  duration: number
  command: string
  target: ShellExecutionTarget
}

export interface ShellCommandDecision {
  allowed: boolean
  blocked?: boolean
  autoApproved?: boolean
  requiresApproval?: boolean
  reason?: string
  parsed: ParsedCommand
}

export interface ParsedCommand {
  baseCommand: string
  args: string[]
  tokens: string[]
  isDangerous: boolean
  dangerReason?: string
  usesShellFeatures: boolean
  shellFeatureReason?: string
}

export interface ShellApprovalClaims {
  userId: string
  command: string
  cwd?: string
  issuedAt: number
}

function getApprovalSecret() {
  return getJwtSecret()
}

const DANGEROUS_COMMAND_PREFIXES = [
  'mkfs',
  'nc',
  'netcat',
  'nmap',
  'passwd',
  'scp',
  'sftp',
  'ssh',
  'su',
  'sudo',
  'visudo',
]

const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[;&|]\s*)rm\s+-rf\s+\/($|[\s;&|])/i, reason: 'Contains dangerous pattern: rm -rf /' },
  { pattern: /(^|[;&|]\s*)rm\s+-rf\s+\/\*/i, reason: 'Contains dangerous pattern: rm -rf /*' },
  { pattern: /(^|[;&|]\s*)dd\s+if=\/dev\/zero\b/i, reason: 'Contains dangerous pattern: dd if=/dev/zero' },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\};:/, reason: 'Contains dangerous pattern: fork bomb' },
  { pattern: /(^|[;&|]\s*)chmod\s+-R\s+777\s+\/($|[\s;&|])/i, reason: 'Contains dangerous pattern: chmod -R 777 /' },
  { pattern: /\bchown\s+-R\b/i, reason: 'Contains dangerous pattern: chown -R' },
  { pattern: /\bnc\s+-l\b/i, reason: 'Contains dangerous pattern: nc -l' },
  { pattern: /\/etc\/(?:passwd|shadow)\b/i, reason: 'Access to sensitive system files is blocked' },
]

// Commands that require approval (unless in auto-approve mode)
const SAFE_COMMANDS = [
  'ls',
  'pwd',
  'echo',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'rg',
  'find',
  'which',
  'command -v',
  'type',
  'stat',
  'file',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'env',
  'printenv',
  'sed',
  'awk',
  'sort',
  'uniq',
  'cut',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'git',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'node',
  'python',
  'python3',
  'docker',
  'docker compose',
  'prisma',
  'tsc',
  'eslint',
  'prettier',
]

const APPROVAL_REQUIRED_COMMANDS = [
  'apk',
  'apt',
  'apt-get',
  'brew',
  'curl',
  'dnf',
  'docker compose exec',
  'docker compose pull',
  'docker compose run',
  'docker compose up',
  'docker exec',
  'docker pull',
  'docker run',
  'git clone',
  'git fetch',
  'git lfs',
  'git ls-remote',
  'git pull',
  'git push',
  'git submodule',
  'npm create',
  'npm exec',
  'npm init',
  'npm install',
  'npm run',
  'npx',
  'pacman',
  'pip install',
  'pip3 install',
  'pnpm add',
  'pnpm create',
  'pnpm dlx',
  'pnpm exec',
  'pnpm install',
  'pnpm run',
  'pnpm update',
  'python -m pip install',
  'python3 -m pip install',
  'wget',
  'yum',
  'yarn add',
  'yarn create',
  'yarn dlx',
  'yarn install',
  'yarn run',
  'yarn upgrade',
]

const SHELL_FEATURE_PATTERN = /&&|\|\||[|;`]|>>?|<<?|\$\(|\r|\n/

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function normalizeCwd(cwd?: string): string | undefined {
  if (typeof cwd !== 'string') return undefined
  const trimmed = cwd.trim()
  return trimmed || undefined
}

function normalizeShellPath(input: string): string {
  return input.trim().replace(/\\/g, '/')
}

function isWithinPath(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalizeShellPath(targetPath)
  const normalizedRoot = normalizeShellPath(rootPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

function hostRelativeToContainer(hostPath: string, hostRoot: string, containerRoot: string): string {
  const relative = normalizeShellPath(hostPath).slice(normalizeShellPath(hostRoot).length).replace(/^\//, '')
  return path.join(containerRoot, relative)
}

export function resolveContainerShellCwd(cwd?: string): string {
  const containerRoot = getOpenClawWorkspaceContainerRoot()
  const hostRoot = getOpenClawWorkspaceHostRoot()
  const normalized = normalizeCwd(cwd)
  if (!normalized) return containerRoot

  const resolved = normalizeShellPath(normalized)
  if (isWithinPath(resolved, containerRoot)) return resolved

  if (isWithinPath(resolved, hostRoot)) {
    return hostRelativeToContainer(resolved, hostRoot, containerRoot)
  }

  // If the cwd looks like a Windows path but the host root is not Windows,
  // the user may have mixed configs. Fall back to container root rather than
  // constructing an invalid path.
  if (isWindowsHostPath(resolved) && !isWindowsHostPath(hostRoot)) {
    return containerRoot
  }

  return containerRoot
}

function matchesCommandPrefix(tokens: string[], prefix: string): boolean {
  const prefixTokens = tokenizeCommand(prefix)
  if (prefixTokens.length === 0 || tokens.length < prefixTokens.length) return false
  return prefixTokens.every((token, index) => token === tokens[index])
}

function isAllowlistedCommand(command: string, allowedCommands: string[]): boolean {
  const tokens = tokenizeCommand(command)
  const allowlist = [...SAFE_COMMANDS, ...allowedCommands]
  return allowlist.some(prefix => matchesCommandPrefix(tokens, prefix))
}

function requiresExplicitApproval(command: string): boolean {
  const tokens = tokenizeCommand(command)
  return APPROVAL_REQUIRED_COMMANDS.some(prefix => matchesCommandPrefix(tokens, prefix))
}

export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim()
  const tokens = tokenizeCommand(trimmed)
  const baseCommand = tokens[0] || ''
  const args = tokens.slice(1)

  for (const blockedPrefix of DANGEROUS_COMMAND_PREFIXES) {
    if (matchesCommandPrefix(tokens, blockedPrefix)) {
      return {
        baseCommand,
        args,
        tokens,
        isDangerous: true,
        dangerReason: `Contains dangerous command: ${blockedPrefix}`,
        usesShellFeatures: false,
      }
    }
  }

  for (const entry of DANGEROUS_COMMAND_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return {
        baseCommand,
        args,
        tokens,
        isDangerous: true,
        dangerReason: entry.reason,
        usesShellFeatures: false,
      }
    }
  }

  if (trimmed.includes('| sudo') || trimmed.includes('> /etc/') || trimmed.includes('>> /etc/')) {
    return {
      baseCommand,
      args,
      tokens,
      isDangerous: true,
      dangerReason: 'Contains potentially dangerous redirection',
      usesShellFeatures: false,
    }
  }

  const usesShellFeatures = SHELL_FEATURE_PATTERN.test(trimmed)

  return {
    baseCommand,
    args,
    tokens,
    isDangerous: false,
    usesShellFeatures,
    shellFeatureReason: usesShellFeatures
      ? 'Uses shell operators or redirection and requires explicit approval'
      : undefined,
  }
}

export function getShellCommandDecision(
  command: string,
  mode: ShellExecutionMode,
  allowedCommands: string[]
): ShellCommandDecision {
  const parsed = parseCommand(command)

  if (mode === 'deny') {
    return {
      allowed: false,
      blocked: true,
      reason: 'Shell execution is disabled',
      parsed,
    }
  }

  if (parsed.isDangerous) {
    return {
      allowed: false,
      blocked: true,
      reason: parsed.dangerReason,
      parsed,
    }
  }

  if (mode === 'ask-first') {
    return { allowed: true, requiresApproval: true, parsed }
  }

  if (parsed.usesShellFeatures) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: parsed.shellFeatureReason,
      parsed,
    }
  }

  if (requiresExplicitApproval(command)) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: 'Command requires explicit approval because it may access the network, install software, or launch external services.',
      parsed,
    }
  }

  if (!isAllowlistedCommand(command, allowedCommands)) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: 'Command is not in the auto-approved allowlist.',
      parsed,
    }
  }

  return { allowed: true, autoApproved: true, parsed }
}

export function isCommandAllowed(
  command: string,
  mode: ShellExecutionMode,
  allowedCommands: string[]
): { allowed: boolean; reason?: string } {
  const decision = getShellCommandDecision(command, mode, allowedCommands)
  if (!decision.allowed) {
    return { allowed: false, reason: decision.reason }
  }

  if (decision.autoApproved) {
    return { allowed: true }
  }

  return { allowed: false, reason: decision.reason || 'Command requires explicit approval.' }
}

export async function executeCommand(
  command: string,
  options: {
    cwd?: string
    timeout?: number
  } = {}
): Promise<ShellCommandResult> {
  const startTime = Date.now()
  const { timeout = 120000 } = options

  try {
    await ensureOpenClawWorkspaceAlias()
    const cwd = resolveContainerShellCwd(options.cwd)
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024 * 5, // 5MB buffer
    })

    return {
      success: true,
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
      duration: Date.now() - startTime,
      command,
      target: 'container',
    }
  } catch (error: unknown) {
    const executionError = error as {
      stdout?: string
      stderr?: string
      message?: string
      code?: number | null
    }

    return {
      success: false,
      stdout: executionError.stdout || '',
      stderr: executionError.stderr || executionError.message || '',
      exitCode: executionError.code || null,
      duration: Date.now() - startTime,
      command,
      target: 'container',
    }
  }
}

export function createShellApprovalToken(input: {
  userId: string
  command: string
  cwd?: string
}): string {
  const claims: ShellApprovalClaims = {
    userId: input.userId,
    command: input.command.trim(),
    cwd: normalizeCwd(input.cwd),
    issuedAt: Date.now(),
  }

  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', getApprovalSecret()).update(encodedClaims).digest('hex')
  return `${encodedClaims}.${signature}`
}

export function verifyShellApprovalToken(
  token: string,
  expected: {
    userId: string
    command: string
    cwd?: string
  }
): { valid: boolean; reason?: string } {
  const [encodedClaims, signature] = token.split('.')
  if (!encodedClaims || !signature) {
    return { valid: false, reason: 'Missing or malformed approval token' }
  }

  const expectedSignature = createHmac('sha256', getApprovalSecret()).update(encodedClaims).digest('hex')

  try {
    const actualBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      return { valid: false, reason: 'Approval token signature mismatch' }
    }
  } catch {
    return { valid: false, reason: 'Approval token signature mismatch' }
  }

  try {
    const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf-8')) as ShellApprovalClaims

    if (Date.now() - claims.issuedAt > APPROVAL_TTL_MS) {
      return { valid: false, reason: 'Approval token expired' }
    }

    if (claims.userId !== expected.userId) {
      return { valid: false, reason: 'Approval token belongs to a different user' }
    }

    if (claims.command !== expected.command.trim()) {
      return { valid: false, reason: 'Approval token does not match this command' }
    }

    if ((claims.cwd || undefined) !== normalizeCwd(expected.cwd)) {
      return { valid: false, reason: 'Approval token does not match this working directory' }
    }

    return { valid: true }
  } catch {
    return { valid: false, reason: 'Approval token payload is invalid' }
  }
}

export function formatCommandOutput(result: ShellCommandResult): string {
  const lines: string[] = []

  lines.push(`$ ${result.command}`)
  lines.push(`Duration: ${result.duration}ms`)
  lines.push('')

  if (result.stdout) {
    lines.push('STDOUT:')
    lines.push(result.stdout)
    lines.push('')
  }

  if (result.stderr) {
    lines.push('STDERR:')
    lines.push(result.stderr)
    lines.push('')
  }

  lines.push(`Exit code: ${result.exitCode}`)

  return lines.join('\n')
}

export function stripAnsiCodes(str: string): string {
  return str.replace(/[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}
