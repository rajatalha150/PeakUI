import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { getAuthCookieOptions, shouldUseSecureCookies, signToken } from '@/lib/auth'
import { normalizeUsername, validatePassword, validateUsername } from '@/lib/auth-validation'
import { prisma } from '@/lib/prisma'

const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials.'
const DUMMY_PASSWORD_HASH = '$2b$12$OPCmlkd0YvYoSkUIHQQhuOz0IXJ.6zxVcXfJ2j/1eIooAQG9dBmZS'

function invalidCredentialsResponse() {
  return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 })
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      username?: unknown
      password?: unknown
    }
    const username = normalizeUsername(body.username)
    const password = typeof body.password === 'string' ? body.password : ''

    const usernameError = validateUsername(username)
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 })
    }

    const totalUsers = await prisma.user.count()
    const passwordError = validatePassword(password)
    if (totalUsers === 0 && passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }
    if (!password) {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 })
    }

    let user = null

    if (totalUsers === 0) {
      const passwordHash = await bcrypt.hash(password, 12)
      try {
        user = await prisma.$transaction(async tx => {
          const existingUser = await tx.user.findFirst({
            select: { id: true },
          })
          if (existingUser) return null

          const conflictingUsername = await tx.user.findFirst({
            where: {
              username: {
                equals: username,
                mode: 'insensitive',
              },
            },
            select: { id: true },
          })
          if (conflictingUsername) return null

          return tx.user.create({
            data: {
              username,
              passwordHash,
              role: 'ADMIN',
            },
          })
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
      } catch {
        user = null
      }
    }

    if (!user) {
      const existingUser = await prisma.user.findFirst({
        where: {
          username: {
            equals: username,
            mode: 'insensitive',
          },
        },
      })
      const isValid = await bcrypt.compare(password, existingUser?.passwordHash ?? DUMMY_PASSWORD_HASH)

      if (!existingUser || !isValid || !existingUser.isActive) {
        return invalidCredentialsResponse()
      }

      user = existingUser
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const token = await signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    })

    const response = NextResponse.json({ success: true, user: { username: user.username, role: user.role } })
    response.cookies.set({
      name: 'auth_token',
      value: token,
      ...getAuthCookieOptions(shouldUseSecureCookies(req)),
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
