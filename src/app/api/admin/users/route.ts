import { NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { normalizeUsername, validatePassword, validateUsername } from '@/lib/auth-validation'
import {
  hasPermission,
  isPermissionKey,
  listPermissionDefinitions,
  listRoleDefinitions,
  parsePermissionOverrides,
  resolvePermissions,
  serializePermissionOverrides,
  type PermissionOverrides,
} from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'
import { DEFAULT_SETTINGS } from '@/lib/settings'

function isRole(value: unknown): value is Role {
  return value === 'ADMIN' || value === 'MANAGER' || value === 'USER'
}

function normalizeOverrides(input: unknown): PermissionOverrides {
  const object = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  return {
    allow: Array.isArray(object.allow) ? object.allow.filter(isPermissionKey) : [],
    deny: Array.isArray(object.deny) ? object.deny.filter(isPermissionKey) : [],
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

  if (!hasPermission(auth.user, 'users.manage')) {
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
  const overrides = parsePermissionOverrides(user.permissionOverrides)
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    permissions: resolvePermissions(user),
    permissionOverrides: overrides,
  }
}

export async function GET() {
  try {
    const { error } = await requireUserManager()
    if (error) return error

    const users = await prisma.user.findMany({
      orderBy: [
        { role: 'asc' },
        { username: 'asc' },
      ],
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

    return NextResponse.json({
      users: users.map(toClientUser),
      permissionDefinitions: listPermissionDefinitions(),
      roleDefinitions: listRoleDefinitions(),
    })
  } catch (error) {
    console.error('Admin users GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error } = await requireUserManager()
    if (error) return error

    const body = await request.json() as {
      username?: unknown
      password?: unknown
      role?: unknown
      isActive?: unknown
      permissionOverrides?: unknown
    }

    const username = normalizeUsername(body.username)
    const usernameError = validateUsername(username)
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 })
    }

    const passwordError = validatePassword(body.password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    const role = isRole(body.role) ? body.role : 'USER'
    const isActive = body.isActive !== false
    const permissionOverrides = serializePermissionOverrides(normalizeOverrides(body.permissionOverrides))

    const existingUser = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    })
    if (existingUser) {
      return NextResponse.json({ error: 'A user with that username already exists.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(body.password as string, 12)
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role,
        isActive,
        permissionOverrides,
        settings: {
          create: DEFAULT_SETTINGS,
        },
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

    return NextResponse.json({ user: toClientUser(user) }, { status: 201 })
  } catch (error) {
    console.error('Admin users POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
