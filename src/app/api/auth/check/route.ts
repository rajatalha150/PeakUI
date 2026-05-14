import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth } from '@/lib/request-auth'

export async function GET() {
  try {
    const [count, auth] = await Promise.all([
      prisma.user.count(),
      getCurrentAuth(),
    ])

    return NextResponse.json({
      isSetupNeeded: count === 0,
      authenticated: Boolean(auth),
      user: auth ? {
        id: auth.user.id,
        username: auth.user.username,
        role: auth.user.role,
        permissions: auth.permissions,
      } : null,
    })
  } catch (error) {
    console.error('Error checking setup status:', error)
    return NextResponse.json({ isSetupNeeded: false, error: 'Database connection failed' }, { status: 500 })
  }
}
