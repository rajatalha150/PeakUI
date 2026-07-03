import * as os from 'os'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  OpenClawFileAccessMode,
  OpenClawFileWriteMode,
} from './settings'
import {
  getOpenClawWorkspaceContainerRoot,
  getOpenClawWorkspaceHostRoot,
  isWindowsHostPath,
} from './openclaw-workspace'

export type OpenClawFilesystemReadAction = 'list' | 'read' | 'stat'
export type OpenClawFilesystemWriteAction = 'write' | 'append' | 'mkdir'
export type OpenClawFilesystemAction = OpenClawFilesystemReadAction | OpenClawFilesystemWriteAction

export interface OpenClawFilesystemRequest {
  action: OpenClawFilesystemAction
  path: string
  content?: string
  createDirectories?: boolean
}

export interface OpenClawFilesystemResult {
  action: OpenClawFilesystemAction
  path: string
  kind: 'file' | 'directory'
  content?: string
  truncated?: boolean
  size?: number
  modifiedAt?: string
  created?: boolean
  bytesWritten?: number
  entries?: Array<{
    name: string
    path: string
    kind: 'file' | 'directory'
    size?: number
  }>
}

export interface OpenClawFilesystemAccessSettings {
  openClawFileAccessMode: OpenClawFileAccessMode
  openClawAllowedPaths: string
  openClawFileWriteMode: OpenClawFileWriteMode
  openClawWritablePaths: string
}

export interface OpenClawFilesystemWriteValidation {
  action: OpenClawFilesystemWriteAction
  path: string
  contentBytes?: number
  createDirectories: boolean
}

export interface OpenClawFilesystemApprovalPayload {
  action: OpenClawFilesystemWriteAction
  path: string
  content?: string
  createDirectories?: boolean
}

export interface OpenClawMountedRoot {
  label: string
  hostPath: string
  containerPath: string
  writable: boolean
}

export type OpenClawFilesystemDiagnosticCode =
  | 'ok'
  | 'invalid_path'
  | 'filesystem_read_disabled'
  | 'filesystem_write_disabled'
  | 'no_approved_read_roots'
  | 'no_approved_writable_roots'
  | 'outside_approved_read_roots'
  | 'outside_approved_writable_roots'
  | 'outside_mounted_host_roots'
  | 'outside_mounted_writable_roots'
  | 'missing_approval_token'

export interface OpenClawFilesystemDiagnostic {
  allowed: boolean
  code: OpenClawFilesystemDiagnosticCode
  message: string
  actionRequired?: string
  requestedPath?: string
  normalizedPath?: string
  approvedRoot?: string
  mountedRoot?: OpenClawMountedRoot
}

export interface OpenClawFilesystemAccessStatus {
  readMode: OpenClawFileAccessMode
  writeMode: OpenClawFileWriteMode
  approvedReadRoots: string[]
  approvedWritableRoots: string[]
  mountedRoots: OpenClawMountedRoot[]
  mountedWritableRoots: OpenClawMountedRoot[]
  readReady: boolean
  writeReady: boolean
  warnings: string[]
}

const FILE_READ_LIMIT_BYTES = 180_000
const FILE_WRITE_PREVIEW_LIMIT_BYTES = 4_000
const FILE_WRITE_LIMIT_BYTES = 250_000
const DIRECTORY_LIST_LIMIT = 200

export function normalizeRequestPath(input: string): string {
  return input.trim().replace(/\\/g, '/')
}

function normalizeAbsolutePath(input: string): string {
  const normalized = normalizeRequestPath(input)
  // Preserve Windows absolute paths (C:/...) inside the Linux container.
  if (isWindowsHostPath(normalized)) {
    return normalized.replace(/\/+$/, '')
  }
  // Expand leading '~' to the user's home directory before resolving.
  // path.resolve('~/.peakui/workspace') would otherwise produce a path
  // relative to the current working directory, breaking approved-root checks.
  if (normalized.startsWith('~/')) {
    return path.resolve(path.join(os.homedir(), normalized.slice(2)))
  }
  return path.resolve(normalized)
}

function isWithinPath(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalizeRequestPath(targetPath)
  const normalizedRoot = normalizeRequestPath(rootPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export function hostRelativeToContainer(hostPath: string, hostRoot: string, containerRoot: string): string {
  const relative = normalizeRequestPath(hostPath).slice(normalizeRequestPath(hostRoot).length).replace(/^\//, '')
  return path.join(containerRoot, relative)
}

function getMountedRoots(): OpenClawMountedRoot[] {
  const roots = [
    {
      label: 'Host home tree',
      hostPath: normalizeAbsolutePath(process.env.OPENCLAW_HOST_HOME_DIR || '/home'),
      containerPath: '/mnt/openclaw/home',
      writable: false,
    },
    {
      label: 'Host temp',
      hostPath: normalizeAbsolutePath(process.env.OPENCLAW_HOST_TMP_DIR || '/tmp'),
      containerPath: '/mnt/openclaw/tmp',
      writable: false,
    },
    {
      label: 'Managed workspace',
      hostPath: getOpenClawWorkspaceHostRoot(),
      containerPath: getOpenClawWorkspaceContainerRoot(),
      writable: true,
    },
  ]

  return roots.filter((root, index, all) => all.findIndex(other => other.hostPath === root.hostPath) === index)
}

export function isOpenClawFilesystemWriteAction(action: OpenClawFilesystemAction): action is OpenClawFilesystemWriteAction {
  return action === 'write' || action === 'append' || action === 'mkdir'
}

export function isOpenClawFilesystemReadAction(action: OpenClawFilesystemAction): action is OpenClawFilesystemReadAction {
  return action === 'list' || action === 'read' || action === 'stat'
}

export function parseAllowedOpenClawPaths(rawValue: string): string[] {
  return rawValue
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(normalizeAbsolutePath)
    .filter((entry, index, all) => all.indexOf(entry) === index)
}

export function buildOpenClawFilesystemApprovalPayload(
  request: OpenClawFilesystemRequest,
  normalizedPath: string
): OpenClawFilesystemApprovalPayload {
  return {
    action: request.action as OpenClawFilesystemWriteAction,
    path: normalizedPath,
    ...(typeof request.content === 'string' ? { content: request.content } : {}),
    ...(request.createDirectories === true ? { createDirectories: true } : {}),
  }
}

export function getMountedOpenClawHostRoots(): string[] {
  return getMountedRoots().map(root => root.hostPath)
}

export function getMountedOpenClawWritableRoots(): string[] {
  return getMountedRoots().filter(root => root.writable).map(root => root.hostPath)
}

export function getMountedOpenClawRootDetails(): OpenClawMountedRoot[] {
  return getMountedRoots().map(root => ({ ...root }))
}

function resolveMountedRootForPath(hostPath: string, options?: { writableOnly?: boolean }): OpenClawMountedRoot | null {
  const normalized = normalizeAbsolutePath(hostPath)
  const roots = getMountedRoots()
    .filter(root => !options?.writableOnly || root.writable)
    .sort((a, b) => b.hostPath.length - a.hostPath.length)

  return roots.find(root => isWithinPath(normalized, root.hostPath)) || null
}

function findAuthorizedRoot(normalizedHostPath: string, allowedRoots: string[]): string | null {
  return [...allowedRoots]
    .sort((a, b) => b.length - a.length)
    .find(root => isWithinPath(normalizedHostPath, root)) || null
}

export function buildOpenClawFilesystemAccessStatus(
  settings: OpenClawFilesystemAccessSettings
): OpenClawFilesystemAccessStatus {
  const approvedReadRoots = parseAllowedOpenClawPaths(settings.openClawAllowedPaths)
  const approvedWritableRoots = parseAllowedOpenClawPaths(settings.openClawWritablePaths)
  const mountedRoots = getMountedOpenClawRootDetails()
  const mountedWritableRoots = mountedRoots.filter(root => root.writable)
  const warnings: string[] = []

  if (settings.openClawFileAccessMode === 'read-only' && approvedReadRoots.length === 0) {
    warnings.push('Read-only filesystem access is enabled, but no approved host read roots are configured.')
  }

  if (settings.openClawFileWriteMode !== 'deny' && approvedWritableRoots.length === 0) {
    warnings.push('Filesystem writes are enabled, but no approved writable roots are configured.')
  }

  if (approvedReadRoots.some(root => !resolveMountedRootForPath(root))) {
    warnings.push('One or more approved read roots are outside the Docker-mounted host roots.')
  }

  if (approvedWritableRoots.some(root => !resolveMountedRootForPath(root, { writableOnly: true }))) {
    warnings.push('One or more approved writable roots are outside the Docker-mounted writable roots.')
  }

  return {
    readMode: settings.openClawFileAccessMode,
    writeMode: settings.openClawFileWriteMode,
    approvedReadRoots,
    approvedWritableRoots,
    mountedRoots,
    mountedWritableRoots,
    readReady: settings.openClawFileAccessMode === 'read-only'
      && approvedReadRoots.length > 0
      && approvedReadRoots.some(root => Boolean(resolveMountedRootForPath(root))),
    writeReady: settings.openClawFileWriteMode !== 'deny'
      && approvedWritableRoots.length > 0
      && approvedWritableRoots.some(root => Boolean(resolveMountedRootForPath(root, { writableOnly: true }))),
    warnings,
  }
}

export function diagnoseOpenClawFilesystemRequest(
  request: OpenClawFilesystemRequest,
  settings: OpenClawFilesystemAccessSettings,
  options: { approvalTokenPresent?: boolean } = {}
): OpenClawFilesystemDiagnostic {
  const requestedPath = typeof request.path === 'string' ? request.path.trim() : ''
  if (!requestedPath) {
    return {
      allowed: false,
      code: 'invalid_path',
      message: 'A valid absolute host path is required.',
      actionRequired: 'Use an absolute host path, for example /home/user/project or ~/.peakui/workspace.',
    }
  }

  const normalizedPath = normalizeAbsolutePath(requestedPath)
  const isWriteAction = isOpenClawFilesystemWriteAction(request.action)

  if (!isWriteAction && settings.openClawFileAccessMode !== 'read-only') {
    return {
      allowed: false,
      code: 'filesystem_read_disabled',
      message: 'Filesystem read access is disabled.',
      actionRequired: 'Enable Settings -> WorkSpaces -> Filesystem Access, then add at least one approved host read path.',
      requestedPath,
      normalizedPath,
    }
  }

  if (isWriteAction && settings.openClawFileWriteMode === 'deny') {
    return {
      allowed: false,
      code: 'filesystem_write_disabled',
      message: 'Filesystem writes are disabled.',
      actionRequired: 'Enable Settings -> WorkSpaces -> Filesystem Writes in ask-first mode and approve a writable root.',
      requestedPath,
      normalizedPath,
    }
  }

  const approvedRoots = isWriteAction
    ? parseAllowedOpenClawPaths(settings.openClawWritablePaths)
    : parseAllowedOpenClawPaths(settings.openClawAllowedPaths)

  if (approvedRoots.length === 0) {
    return {
      allowed: false,
      code: isWriteAction ? 'no_approved_writable_roots' : 'no_approved_read_roots',
      message: isWriteAction
        ? 'No approved writable host roots are configured.'
        : 'No approved host read roots are configured.',
      actionRequired: isWriteAction
        ? 'Add a writable root such as ~/.peakui/workspace in Settings.'
        : 'Add an approved host read root such as /home or /tmp in Settings.',
      requestedPath,
      normalizedPath,
    }
  }

  const approvedRoot = findAuthorizedRoot(normalizedPath, approvedRoots)
  if (!approvedRoot) {
    return {
      allowed: false,
      code: isWriteAction ? 'outside_approved_writable_roots' : 'outside_approved_read_roots',
      message: isWriteAction
        ? 'Requested path is not inside the approved writable roots.'
        : 'Requested path is not inside the approved filesystem roots.',
      actionRequired: `Approve a matching ${isWriteAction ? 'writable' : 'read'} root in Settings, or request a path under: ${approvedRoots.join(', ')}.`,
      requestedPath,
      normalizedPath,
    }
  }

  const mountedRoot = resolveMountedRootForPath(normalizedPath, { writableOnly: isWriteAction })
  if (!mountedRoot) {
    const mountedRoots = isWriteAction ? getMountedOpenClawWritableRoots() : getMountedOpenClawHostRoots()
    return {
      allowed: false,
      code: isWriteAction ? 'outside_mounted_writable_roots' : 'outside_mounted_host_roots',
      message: isWriteAction
        ? 'Requested path is outside the mounted writable roots.'
        : 'Requested path is outside the mounted host roots.',
      actionRequired: `Add a Docker bind mount for that host path first, then approve it in Settings. Currently mounted roots: ${mountedRoots.join(', ') || 'none'}.`,
      requestedPath,
      normalizedPath,
      approvedRoot,
    }
  }

  if (isWriteAction && settings.openClawFileWriteMode === 'ask-first' && !options.approvalTokenPresent) {
    return {
      allowed: false,
      code: 'missing_approval_token',
      message: 'Filesystem write blocked: Missing approval token.',
      actionRequired: 'Request write approval first, then execute the approved filesystem action with the returned token.',
      requestedPath,
      normalizedPath,
      approvedRoot,
      mountedRoot,
    }
  }

  return {
    allowed: true,
    code: 'ok',
    message: 'Filesystem request is allowed by the current configuration.',
    requestedPath,
    normalizedPath,
    approvedRoot,
    mountedRoot,
  }
}

async function resolveNearestExistingRealPath(inputPath: string): Promise<string> {
  let currentPath = inputPath

  while (true) {
    try {
      return await fs.realpath(currentPath)
    } catch {
      const parentPath = path.dirname(currentPath)
      if (parentPath === currentPath) {
        throw new Error('Resolved path is not available inside the mounted filesystem roots')
      }
      currentPath = parentPath
    }
  }
}

async function resolveReadableContainerPaths(
  requestedHostPath: string,
  settings: OpenClawFilesystemAccessSettings
): Promise<{
  normalizedHostPath: string
  containerPath: string
}> {
  if (settings.openClawFileAccessMode !== 'read-only') {
    throw new Error('Filesystem access is disabled')
  }

  const normalizedHostPath = normalizeAbsolutePath(requestedHostPath)
  const allowedRoots = parseAllowedOpenClawPaths(settings.openClawAllowedPaths)
  const authorizedRoot = findAuthorizedRoot(normalizedHostPath, allowedRoots)

  if (!authorizedRoot) {
    throw new Error('Requested path is not inside the approved filesystem roots')
  }

  const mountedRoot = resolveMountedRootForPath(normalizedHostPath)
  if (!mountedRoot) {
    throw new Error(`Requested path is outside the mounted host roots. Available mounted roots: ${getMountedOpenClawHostRoots().join(', ')}`)
  }

  const containerPath = hostRelativeToContainer(normalizedHostPath, mountedRoot.hostPath, mountedRoot.containerPath)
  const allowedContainerRoot = hostRelativeToContainer(authorizedRoot, mountedRoot.hostPath, mountedRoot.containerPath)

  let realAllowedRoot: string
  let realTargetPath: string

  try {
    realAllowedRoot = await fs.realpath(allowedContainerRoot)
  } catch {
    throw new Error('Approved path is not available inside the container mount')
  }

  try {
    realTargetPath = await fs.realpath(containerPath)
  } catch {
    throw new Error('Requested path does not exist')
  }

  if (!isWithinPath(realTargetPath, realAllowedRoot)) {
    throw new Error('Requested path resolves outside the approved filesystem root')
  }

  return {
    normalizedHostPath,
    containerPath: realTargetPath,
  }
}

async function resolveWritableContainerPaths(
  requestedHostPath: string,
  settings: OpenClawFilesystemAccessSettings
): Promise<{
  normalizedHostPath: string
  containerPath: string
}> {
  if (settings.openClawFileWriteMode === 'deny') {
    throw new Error('Filesystem writes are disabled')
  }

  const normalizedHostPath = normalizeAbsolutePath(requestedHostPath)
  const allowedRoots = parseAllowedOpenClawPaths(settings.openClawWritablePaths)
  const authorizedRoot = findAuthorizedRoot(normalizedHostPath, allowedRoots)

  if (!authorizedRoot) {
    throw new Error('Requested path is not inside the approved writable roots')
  }

  const mountedRoot = resolveMountedRootForPath(normalizedHostPath, { writableOnly: true })
  if (!mountedRoot) {
    throw new Error(`Requested path is outside the mounted writable roots. Available writable roots: ${getMountedOpenClawWritableRoots().join(', ')}`)
  }

  const logicalContainerPath = hostRelativeToContainer(normalizedHostPath, mountedRoot.hostPath, mountedRoot.containerPath)
  const logicalAllowedRoot = hostRelativeToContainer(authorizedRoot, mountedRoot.hostPath, mountedRoot.containerPath)

  const realMountedRoot = await fs.realpath(mountedRoot.containerPath).catch(() => {
    throw new Error('Writable workspace root is not available inside the container mount')
  })

  const realTargetAnchor = await resolveNearestExistingRealPath(logicalContainerPath)
  const realAllowedAnchor = await resolveNearestExistingRealPath(logicalAllowedRoot)

  if (!isWithinPath(realTargetAnchor, realMountedRoot) || !isWithinPath(realAllowedAnchor, realMountedRoot)) {
    throw new Error('Requested path resolves outside the mounted writable root')
  }

  if (!isWithinPath(logicalContainerPath, logicalAllowedRoot)) {
    throw new Error('Requested path resolves outside the approved writable root')
  }

  return {
    normalizedHostPath,
    containerPath: logicalContainerPath,
  }
}

export async function validateOpenClawFilesystemWriteRequest(
  request: OpenClawFilesystemRequest,
  settings: OpenClawFilesystemAccessSettings
): Promise<OpenClawFilesystemWriteValidation> {
  if (!isOpenClawFilesystemWriteAction(request.action)) {
    throw new Error('This validation helper only supports write actions')
  }

  const requestedPath = typeof request.path === 'string' ? request.path.trim() : ''
  if (!requestedPath) {
    throw new Error('A valid absolute path is required')
  }

  await resolveWritableContainerPaths(requestedPath, settings)

  if (request.action === 'mkdir') {
    return {
      action: request.action,
      path: normalizeAbsolutePath(requestedPath),
      createDirectories: true,
    }
  }

  const content = typeof request.content === 'string' ? request.content : ''
  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes > FILE_WRITE_LIMIT_BYTES) {
    throw new Error(`Requested file content exceeds the ${FILE_WRITE_LIMIT_BYTES} byte limit`)
  }

  return {
    action: request.action,
    path: normalizeAbsolutePath(requestedPath),
    contentBytes,
    createDirectories: request.createDirectories === true,
  }
}

function buildWritePreviewContent(content: string): { preview: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8')
  const truncated = buffer.length > FILE_WRITE_PREVIEW_LIMIT_BYTES
  const slice = truncated ? buffer.subarray(0, FILE_WRITE_PREVIEW_LIMIT_BYTES) : buffer
  return {
    preview: slice.toString('utf8'),
    truncated,
  }
}

export async function runOpenClawFilesystemRequest(
  request: OpenClawFilesystemRequest,
  settings: OpenClawFilesystemAccessSettings
): Promise<OpenClawFilesystemResult> {
  if (isOpenClawFilesystemReadAction(request.action)) {
    const { normalizedHostPath, containerPath } = await resolveReadableContainerPaths(request.path, settings)
    const stats = await fs.stat(containerPath)

    if (request.action === 'list') {
      if (!stats.isDirectory()) {
        throw new Error('The requested path is not a directory')
      }

      const dirEntries = await fs.readdir(containerPath, { withFileTypes: true })
      const entries = await Promise.all(dirEntries.slice(0, DIRECTORY_LIST_LIMIT).map(async entry => {
        const entryHostPath = path.join(normalizedHostPath, entry.name)
        const entryContainerPath = path.join(containerPath, entry.name)
        const entryStats = await fs.stat(entryContainerPath).catch(() => null)
        return {
          name: entry.name,
          path: entryHostPath,
          kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
          size: entryStats?.isFile() ? entryStats.size : undefined,
        }
      }))

      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return {
        action: request.action,
        path: normalizedHostPath,
        kind: 'directory',
        modifiedAt: stats.mtime.toISOString(),
        entries,
      }
    }

    if (request.action === 'read') {
      if (!stats.isFile()) {
        throw new Error('The requested path is not a file')
      }

      const buffer = await fs.readFile(containerPath)
      const truncated = buffer.length > FILE_READ_LIMIT_BYTES
      const slice = truncated ? buffer.subarray(0, FILE_READ_LIMIT_BYTES) : buffer
      const content = slice.toString('utf-8')

      if (content.includes('\u0000')) {
        throw new Error('The requested file appears to be binary and cannot be read as text')
      }

      return {
        action: request.action,
        path: normalizedHostPath,
        kind: 'file',
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        content,
        truncated,
      }
    }

    return {
      action: request.action,
      path: normalizedHostPath,
      kind: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    }
  }

  const validation = await validateOpenClawFilesystemWriteRequest(request, settings)
  const { normalizedHostPath, containerPath } = await resolveWritableContainerPaths(request.path, settings)

  if (request.action === 'mkdir') {
    await fs.mkdir(containerPath, { recursive: true })
    const stats = await fs.stat(containerPath)
    return {
      action: request.action,
      path: normalizedHostPath,
      kind: 'directory',
      created: true,
      modifiedAt: stats.mtime.toISOString(),
    }
  }

  const parentDirectory = path.dirname(containerPath)
  if (request.createDirectories) {
    await fs.mkdir(parentDirectory, { recursive: true })
  } else {
    await fs.access(parentDirectory).catch(() => {
      throw new Error('Parent directory does not exist. Set createDirectories to true if you want it created automatically.')
    })
  }

  const content = typeof request.content === 'string' ? request.content : ''
  const existedBefore = await fs.stat(containerPath).then(() => true).catch(() => false)

  if (request.action === 'write') {
    await fs.writeFile(containerPath, content, 'utf8')
  } else {
    await fs.appendFile(containerPath, content, 'utf8')
  }

  const stats = await fs.stat(containerPath)
  const { preview, truncated } = buildWritePreviewContent(content)

  return {
    action: request.action,
    path: normalizedHostPath,
    kind: 'file',
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    created: !existedBefore,
    bytesWritten: validation.contentBytes ?? Buffer.byteLength(content, 'utf8'),
    content: preview,
    truncated,
  }
}
