import { NextResponse } from 'next/server'
import { Prisma, type Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { normalizeUsername, validatePassword, validateUsername } from '@/lib/auth-validation'
import {
  hasPermission,
  isPermissionKey,
  parsePermissionOverrides,
  resolvePermissions,
  serializePermissionOverrides,
  type PermissionOverrides,
} from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'

function isRole(value: unknown): value is Role {
  return value === 'ADMIN' || value === 'MANAGER' || value === 'USER'
}

function normalizeOverrides(input: unknown): PermissionOverrides {
  const object = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  return {
    allow: Array.isArray(object.allow) ? object.allow.filter(isPermissionKey).filter(key => key !== 'users.manage') : [],
    deny: Array.isArray(object.deny) ? object.deny.filter(isPermissionKey).filter(key => key !== 'users.manage') : [],
  }
}

async function requireUserManager() {
  const auth = await getCurrentAuth()
  if (!auth) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      auth: null,
    }
  }

  if (auth.user.role !== 'ADMIN' || !hasPermission(auth.user, 'users.manage')) {
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      auth: null,
    }
  }

  return {
    error: null,
    auth,
  }
}

function toClientUser(user: {
  id: string
  username: string
  role: Role
  isActive: boolean
  permissionOverrides: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    permissions: resolvePermissions(user),
    permissionOverrides: parsePermissionOverrides(user.permissionOverrides),
  }
}

async function isLastActiveAdmin(userId: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const count = await tx.user.count({
    where: {
      role: 'ADMIN',
      isActive: true,
      NOT: { id: userId },
    },
  })
  return count === 0
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { error } = await requireUserManager()
    if (error) return error

    const { id } = await context.params
    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        permissionOverrides: true,
      },
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const body = await request.json() as {
      username?: unknown
      password?: unknown
      role?: unknown
      isActive?: unknown
      permissionOverrides?: unknown
    }

    const nextUsername = body.username === undefined
      ? existingUser.username
      : normalizeUsername(body.username)
    const nextRole = body.role === undefined
      ? existingUser.role
      : isRole(body.role)
        ? body.role
        : null
    const nextIsActive = body.isActive === undefined
      ? existingUser.isActive
      : body.isActive === true
    const nextOverrides = body.permissionOverrides === undefined
      ? existingUser.permissionOverrides
      : serializePermissionOverrides(normalizeOverrides(body.permissionOverrides))

    if (body.username !== undefined) {
      const usernameError = validateUsername(nextUsername)
      if (usernameError) {
        return NextResponse.json({ error: usernameError }, { status: 400 })
      }

      const conflictingUser = await prisma.user.findFirst({
        where: {
          username: {
            equals: nextUsername,
            mode: 'insensitive',
          },
          NOT: { id: existingUser.id },
        },
        select: { id: true },
      })
      if (conflictingUser) {
        return NextResponse.json({ error: 'A user with that username already exists.' }, { status: 409 })
      }
    }

    if (!nextRole) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
    }

    if (body.password !== undefined) {
      const passwordError = validatePassword(body.password)
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 })
      }
    }

    const shouldRotateToken = (
      nextUsername !== existingUser.username
      || nextRole !== existingUser.role
      || nextIsActive !== existingUser.isActive
      || nextOverrides !== existingUser.permissionOverrides
      || body.password !== undefined
    )

    const passwordHash = body.password !== undefined ? await bcrypt.hash(body.password as string, 12) : undefined
    const updatedUser = await prisma.$transaction(async tx => {
      if (
        existingUser.role === 'ADMIN'
        && existingUser.isActive
        && (nextRole !== 'ADMIN' || !nextIsActive)
        && await isLastActiveAdmin(existingUser.id, tx)
      ) return null
      return tx.user.update({
        where: { id: existingUser.id },
        data: {
          username: nextUsername,
          role: nextRole,
          isActive: nextIsActive,
          permissionOverrides: nextOverrides,
          passwordHash,
          tokenVersion: shouldRotateToken ? { increment: 1 } : undefined,
        },
        select: {
          id: true,
          username: true,
          role: true,
          isActive: true,
          permissionOverrides: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!updatedUser) return NextResponse.json({ error: 'At least one active admin must remain.' }, { status: 400 })

    return NextResponse.json({ user: toClientUser(updatedUser) })
  } catch (error) {
    console.error('Admin user PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { error } = await requireUserManager()
    if (error) return error

    const { id } = await context.params
    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const deleted = await prisma.$transaction(async tx => {
      if (existingUser.role === 'ADMIN' && existingUser.isActive && await isLastActiveAdmin(existingUser.id, tx)) return false
      await tx.user.delete({ where: { id: existingUser.id } })
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!deleted) return NextResponse.json({ error: 'At least one active admin must remain.' }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Admin user DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
