import type { PermissionKey } from './permissions'

export interface OpenClawToolAccessSettingsLike {
  shellExecutionMode: string
  openClawFileAccessMode: 'deny' | 'read-only'
  openClawFileWriteMode: 'deny' | 'ask-first' | 'auto-approve'
  openClawHostAccessMode: 'deny' | 'ask-first' | 'auto-approve'
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
    browserGranted,
    browserMode: browserGranted ? settings.openClawBrowserMode : 'deny',
    uwafGranted,
    uwafBrowserMode: uwafGranted ? settings.openClawUwafBrowserMode : 'deny',
  }
}
