import path from 'path'
import os from 'os'
import type { PermissionKey } from './permissions'
import {
  normalizeWorkspaceToolBrowserMode,
  normalizeWorkspaceToolCodeExecutionMode,
  normalizeWorkspaceToolFileAccessMode,
  normalizeWorkspaceToolFileWriteMode,
  normalizeWorkspaceToolHostAccessMode,
  normalizeWorkspaceToolUwafBrowserMode,
  normalizeShellExecutionMode,
  normalizeShellExecutionTarget,
  type WorkspaceToolBrowserMode,
  type WorkspaceToolCodeExecutionMode,
  type WorkspaceToolFileAccessMode,
  type WorkspaceToolFileWriteMode,
  type WorkspaceToolHostAccessMode,
  type WorkspaceToolUwafBrowserMode,
  type ShellExecutionMode,
  type ShellExecutionTarget,
} from './settings'

const DEFAULT_WORKSPACE_TOOL_WORKSPACE_HOST_ROOT = path.join(os.homedir(), '.peakui', 'workspace')

export function getEffectiveWorkspaceToolWorkspaceHostRootLocal(settings: { workspaceToolWorkspaceHostRoot: string }): string {
  const override = typeof settings.workspaceToolWorkspaceHostRoot === 'string' ? settings.workspaceToolWorkspaceHostRoot.trim() : ''
  if (override) return override.replace(/\\/g, '/')
  return normalizeHostPath(process.env.WORKSPACE_TOOL_HOST_WORKSPACE_DIR || DEFAULT_WORKSPACE_TOOL_WORKSPACE_HOST_ROOT)
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

export interface WorkspaceToolAccessSettingsLike {
  shellExecutionMode: string
  shellExecutionTarget: string
  workspaceToolFileAccessMode: 'deny' | 'read-only'
  workspaceToolFileWriteMode: 'deny' | 'ask-first' | 'auto-approve'
  workspaceToolHostAccessMode: 'deny' | 'ask-first' | 'auto-approve'
  workspaceToolWorkspaceHostRoot: string
  workspaceToolCodeExecutionMode: 'deny' | 'ask-first' | 'auto-approve'
  workspaceToolBrowserMode: 'deny' | 'read-only' | 'ask-first'
  workspaceToolUwafBrowserMode: 'deny' | 'direct' | 'stealth'
}

export interface EffectiveWorkspaceToolAccess {
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

export function buildEffectiveWorkspaceToolAccess(
  settings: WorkspaceToolAccessSettingsLike,
  permissions: PermissionKey[]
): EffectiveWorkspaceToolAccess {
  const permissionSet = new Set<PermissionKey>(permissions)
  const shellGranted = permissionSet.has('workspace-tool.shell')
  const filesystemGranted = permissionSet.has('workspace-tool.filesystem')
  const codeGranted = permissionSet.has('workspace-tool.code')
  const hostAccessGranted = permissionSet.has('workspace-tool.host')
  const browserGranted = permissionSet.has('workspace-tool.browser')
  const uwafGranted = permissionSet.has('workspace-tool.uwaf')

  return {
    permissions: [...permissionSet],
    shellGranted,
    shellEnabled: shellGranted && settings.shellExecutionMode !== 'deny',
    filesystemGranted,
    filesystemEnabled: filesystemGranted && settings.workspaceToolFileAccessMode === 'read-only',
    filesystemWriteEnabled: filesystemGranted && settings.workspaceToolFileWriteMode !== 'deny',
    codeGranted,
    codeExecutionEnabled: codeGranted && settings.workspaceToolCodeExecutionMode !== 'deny',
    hostAccessGranted,
    hostAccessEnabled: hostAccessGranted && settings.workspaceToolHostAccessMode !== 'deny',
    hostAccessMode: hostAccessGranted ? settings.workspaceToolHostAccessMode : 'deny',
    workspaceHostRoot: getEffectiveWorkspaceToolWorkspaceHostRootLocal(settings),
    browserGranted,
    browserMode: browserGranted ? settings.workspaceToolBrowserMode : 'deny',
    uwafGranted,
    uwafBrowserMode: uwafGranted ? settings.workspaceToolUwafBrowserMode : 'deny',
  }
}
