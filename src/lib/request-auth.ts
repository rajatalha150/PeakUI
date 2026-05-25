import type { Role } from '@prisma/client'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME, type AuthTokenClaims, verifyToken } from './auth'
import { hasPermission, resolvePermissions, type PermissionKey } from './permissions'
import { prisma } from './prisma'

export interface AuthenticatedUser {
  id: string
  username: string
  role: Role
  isActive: boolean
  tokenVersion: number
  permissionOverrides: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}

export interface RequestAuthContext {
  user: AuthenticatedUser
  token: AuthTokenClaims
  permissions: PermissionKey[]
}

async function readAuthTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null
}

function isRole(value: unknown): value is Role {
  return value === 'ADMIN' || value === 'MANAGER' || value === 'USER'
}

async function getUserForToken(token: AuthTokenClaims): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      tokenVersion: true,
      permissionOverrides: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
    },
  })

  if (!user || !isRole(user.role) || !user.isActive) return null
  if (user.tokenVersion !== token.tokenVersion) return null

  return user
}

export async function getCurrentAuth(): Promise<RequestAuthContext | null> {
  const rawToken = await readAuthTokenFromCookies()
  if (!rawToken) return null

  const token = await verifyToken(rawToken)
  if (!token) return null

  const user = await getUserForToken(token)
  if (!user) return null

  return {
    user,
    token,
    permissions: resolvePermissions(user),
  }
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  return (await getCurrentAuth())?.user ?? null
}

export async function getCurrentUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null
}

export async function getCurrentUserIdWithPermission(permission: PermissionKey): Promise<string | null> {
  const auth = await getCurrentAuth()
  if (!auth) return null
  return hasPermission(auth.user, permission) ? auth.user.id : null
}

export async function getCurrentUserIdWithPermissions(permissions: PermissionKey[]): Promise<string | null> {
  const auth = await getCurrentAuth()
  if (!auth) return null
  return permissions.every(permission => hasPermission(auth.user, permission)) ? auth.user.id : null
}

export async function currentUserHasPermission(permission: PermissionKey): Promise<boolean> {
  const auth = await getCurrentAuth()
  if (!auth) return false
  return hasPermission(auth.user, permission)
}

export async function requireCurrentAuthWithPermissions(
  requiredPermissions: PermissionKey[],
  options?: {
    forbiddenMessage?: string
    actionRequired?: string
  }
): Promise<
  | { auth: RequestAuthContext; userId: string }
  | { response: NextResponse }
> {
  const auth = await getCurrentAuth()
  if (!auth) {
    return {
      response: NextResponse.json(
        { error: 'Unauthorized', code: 'unauthorized' },
        { status: 401 }
      ),
    }
  }

  const missingPermissions = requiredPermissions.filter(permission => !auth.permissions.includes(permission))
  if (missingPermissions.length > 0) {
    return {
      response: NextResponse.json(
        {
          error: options?.forbiddenMessage || 'Forbidden',
          code: 'permission_denied',
          missingPermissions,
          ...(options?.actionRequired ? { actionRequired: options.actionRequired } : {}),
        },
        { status: 403 }
      ),
    }
  }

  return {
    auth,
    userId: auth.user.id,
  }
}

export async function getAuthContextFromToken(rawToken: string): Promise<RequestAuthContext | null> {
  const token = await verifyToken(rawToken)
  if (!token) return null

  const user = await getUserForToken(token)
  if (!user) return null

  return {
    user,
    token,
    permissions: resolvePermissions(user),
  }
}
