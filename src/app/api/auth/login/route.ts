import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { signToken } from '@/lib/auth'

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const count = await prisma.user.count()
    let user = null

    if (count === 0) {
      // Setup admin
      const passwordHash = await bcrypt.hash(password, 10)
      user = await prisma.user.create({
        data: {
          username,
          passwordHash,
          role: 'ADMIN'
        }
      })
    } else {
      // Normal login
      user = await prisma.user.findUnique({ where: { username } })
      if (!user) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
      
      const isValid = await bcrypt.compare(password, user.passwordHash)
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
    }

    const token = await signToken({ id: user.id, username: user.username, role: user.role })

    const response = NextResponse.json({ success: true, user: { username: user.username, role: user.role } })
    response.cookies.set({
      name: 'auth_token',
      value: token,
      httpOnly: true,
      path: '/',
      secure: req.url.startsWith('https://') || req.headers.get('x-forwarded-proto') === 'https',
      maxAge: 60 * 60 * 24 * 7 // 1 week
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
