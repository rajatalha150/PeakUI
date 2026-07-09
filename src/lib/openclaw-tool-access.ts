import path from 'path'
import os from 'os'
import type { PermissionKey } from './permissions'
import {
  normalizeOpenClawBrowserMode,
  normalizeOpenClawCodeExecutionMode,
  normalizeOpenClawFileAccessMode,
  normalizeOpenClawFileWriteMode,
  normalizeOpenClawHostAccessMode,
  normalizeOpenClawUwafBrowserMode,
  normalizeShellExecutionMode,
  normalizeShellExecutionTarget,
  type OpenClawBrowserMode,
  type OpenClawCodeExecutionMode,
  type OpenClawFileAccessMode,
  type OpenClawFileWriteMode,
  type OpenClawHostAccessMode,
  type OpenClawUwafBrowserMode,
  type ShellExecutionMode,
  type ShellExecutionTarget,
} from './settings'

const DEFAULT_OPENCLAW_WORKSPACE_HOST_ROOT = path.join(os.homedir(), '.peakui', 'workspace')

export function getEffectiveOpenClawWorkspaceHostRootLocal(settings: { openClawWorkspaceHostRoot: string }): string {
  const override = typeof settings.openClawWorkspaceHostRoot === 'string' ? settings.openClawWorkspaceHostRoot.trim() : ''
  if (override) return override.replace(/\\/g, '/')
  return normalizeHostPath(process.env.OPENCLAW_HOST_WORKSPACE_DIR || DEFAULT_OPENCLAW_WORKSPACE_HOST_ROOT)
}

export function normalizeHostPath(input: string): string {
  let trimmed = input.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (trimmed.startsWith('~/')) {
    trimmed = path.join(os.homedir(), trimmed.slice(2))
  }
  if (/^[A-Za-z]:\//.test(trimmed)) {
    return trimmed
  }
  return path.resolve(trimmed)
}

export interface OpenClawToolAccessSettingsLike {
  shellExecutionMode: string
  shellExecutionTarget: string
  openClawFileAccessMode: 'deny' | 'read-only'
  openClawFileWriteMode: 'deny' | 'ask-first' | 'auto-approve'
  openClawHostAccessMode: 'deny' | 'ask-first' | 'auto-approve'
  openClawWorkspaceHostRoot: string
  openClawCodeExecutionMode: 'deny' | 'ask-first' | 'auto-approve'
  openClawBrowserMode: 'deny' | 'read-only' | 'ask-first'
  openClawUwafBrowserMode: 'deny' | 'direct' | 'stealth'
}

export interface EffectiveOpenClawToolAccess {
  permissions: PermissionKey[]
  shellGranted: boolean
  shellEnabled: boolean
  filesystemGranted: boolean
  filesystemEnabled: boolean
  filesystemWriteEnabled: boolean
  codeGranted: boolean
  codeExecutionEnabled: boolean
  hostAccessGranted: boolean
  hostAccessEnabled: boolean
  hostAccessMode: 'deny' | 'ask-first' | 'auto-approve'
  workspaceHostRoot: string
  browserGranted: boolean
  browserMode: 'deny' | 'read-only' | 'ask-first'
  uwafGranted: boolean
  uwafBrowserMode: 'deny' | 'direct' | 'stealth'
}

export function buildEffectiveOpenClawToolAccess(
  settings: OpenClawToolAccessSettingsLike,
  permissions: PermissionKey[]
): EffectiveOpenClawToolAccess {
  const permissionSet = new Set<PermissionKey>(permissions)
  const shellGranted = permissionSet.has('openclaw.shell')
  const filesystemGranted = permissionSet.has('openclaw.filesystem')
  const codeGranted = permissionSet.has('openclaw.code')
  const hostAccessGranted = permissionSet.has('openclaw.host')
  const browserGranted = permissionSet.has('openclaw.browser')
  const uwafGranted = permissionSet.has('openclaw.uwaf')

  return {
    permissions: [...permissionSet],
    shellGranted,
    shellEnabled: shellGranted && settings.shellExecutionMode !== 'deny',
    filesystemGranted,
    filesystemEnabled: filesystemGranted && settings.openClawFileAccessMode === 'read-only',
    filesystemWriteEnabled: filesystemGranted && settings.openClawFileWriteMode !== 'deny',
    codeGranted,
    codeExecutionEnabled: codeGranted && settings.openClawCodeExecutionMode !== 'deny',
    hostAccessGranted,
    hostAccessEnabled: hostAccessGranted && settings.openClawHostAccessMode !== 'deny',
    hostAccessMode: hostAccessGranted ? settings.openClawHostAccessMode : 'deny',
    workspaceHostRoot: getEffectiveOpenClawWorkspaceHostRootLocal(settings),
    browserGranted,
    browserMode: browserGranted ? settings.openClawBrowserMode : 'deny',
    uwafGranted,
    uwafBrowserMode: uwafGranted ? settings.openClawUwafBrowserMode : 'deny',
  }
}
