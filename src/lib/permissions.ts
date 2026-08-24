import type { Role } from '@prisma/client'

export const ROLE_DEFINITIONS = [
  {
    key: 'ADMIN',
    label: 'Admin',
    description: 'Full system access, including user administration and all WorkSpaces capabilities.',
  },
  {
    key: 'MANAGER',
    label: 'Manager',
    description: 'Power-user access to advanced workspace capabilities without user administration.',
  },
  {
    key: 'USER',
    label: 'User',
    description: 'Standard workspace access with knowledge base, canvas, and core WorkSpaces usage.',
  },
] as const

export const PERMISSION_DEFINITIONS = [
  {
    key: 'knowledge.use',
    label: 'Use knowledge base',
    description: 'Upload, index, search, and delete knowledge-base documents.',
    category: 'Core Workspace',
  },
  {
    key: 'canvas.use',
    label: 'Use canvas',
    description: 'Create and manage canvas artifacts.',
    category: 'Core Workspace',
  },
  {
    key: 'workspace-tool.use',
    label: 'Use WorkSpaces',
    description: 'Access WorkSpaces and model-driven task flows.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.filesystem',
    label: 'Filesystem access',
    description: 'Use WorkSpaces filesystem tools when they are enabled in personal settings.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.browser',
    label: 'Browser access',
    description: 'Use the standard WorkSpaces browser tooling.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.uwaf',
    label: 'Stealth browser access',
    description: 'Use the UWAF live browser and stealth browsing flows.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.shell',
    label: 'Shell execution',
    description: 'Request and execute WorkSpaces shell commands.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.code',
    label: 'Code execution',
    description: 'Run the managed WorkSpaces Python/Node code sandbox.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.host',
    label: 'Unrestricted host access',
    description: 'Bypass sandbox roots and execute commands, code, and filesystem operations directly on the host when the matching personal setting is enabled.',
    category: 'WorkSpaces',
  },
  {
    key: 'workspace-tool.automation',
    label: 'Automation scheduling',
    description: 'Manage autonomous scheduling, monitoring, wake events, and proactive nudges.',
    category: 'WorkSpaces',
  },
  {
    key: 'users.manage',
    label: 'Manage users',
    description: 'Create users, deactivate accounts, reset passwords, and manage roles and permissions.',
    category: 'Administration',
  },
] as const

export type PermissionKey = typeof PERMISSION_DEFINITIONS[number]['key']

export interface PermissionOverrides {
  allow: PermissionKey[]
  deny: PermissionKey[]
}

export interface PermissionSubject {
  role: Role
  permissionOverrides?: string | null
}

export const EMPTY_PERMISSION_OVERRIDES: PermissionOverrides = {
  allow: [],
  deny: [],
}

const ALL_PERMISSIONS = PERMISSION_DEFINITIONS.map(permission => permission.key)

const ROLE_DEFAULTS: Record<Role, PermissionKey[]> = {
  ADMIN: [...ALL_PERMISSIONS],
  MANAGER: [
    'knowledge.use',
    'canvas.use',
    'workspace-tool.use',
    'workspace-tool.filesystem',
    'workspace-tool.browser',
    'workspace-tool.uwaf',
    'workspace-tool.shell',
    'workspace-tool.code',
    'workspace-tool.host',
    'workspace-tool.automation',
  ],
  USER: [
    'knowledge.use',
    'canvas.use',
    'workspace-tool.use',
  ],
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && ALL_PERMISSIONS.includes(value as PermissionKey)
}

function sanitizePermissionKeys(value: unknown): PermissionKey[] {
  if (!Array.isArray(value)) return []
  return value.filter(isPermissionKey)
}

export function parsePermissionOverrides(value: string | null | undefined): PermissionOverrides {
  if (!value) return EMPTY_PERMISSION_OVERRIDES

  try {
    const parsed = JSON.parse(value) as {
      allow?: unknown
      deny?: unknown
    }
    return {
      allow: sanitizePermissionKeys(parsed.allow),
      deny: sanitizePermissionKeys(parsed.deny),
    }
  } catch {
    return EMPTY_PERMISSION_OVERRIDES
  }
}

export function serializePermissionOverrides(overrides: PermissionOverrides): string {
  const normalized: PermissionOverrides = {
    allow: sanitizePermissionKeys(overrides.allow),
    deny: sanitizePermissionKeys(overrides.deny),
  }
  return JSON.stringify(normalized)
}

export function getRolePermissions(role: Role): PermissionKey[] {
  return ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.USER
}

export function resolvePermissions(subject: PermissionSubject): PermissionKey[] {
  if (subject.role === 'ADMIN') return [...ALL_PERMISSIONS]

  const base = new Set<PermissionKey>(getRolePermissions(subject.role))
  const overrides = parsePermissionOverrides(subject.permissionOverrides)

  for (const key of overrides.allow) base.add(key)
  for (const key of overrides.deny) base.delete(key)

  return [...base]
}

export function hasPermission(subject: PermissionSubject, permission: PermissionKey): boolean {
  return resolvePermissions(subject).includes(permission)
}

export function listPermissionDefinitions() {
  return PERMISSION_DEFINITIONS.map(permission => ({ ...permission }))
}

export function listRoleDefinitions() {
  return ROLE_DEFINITIONS.map(role => ({ ...role }))
}
