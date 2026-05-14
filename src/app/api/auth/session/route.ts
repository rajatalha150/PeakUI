import { NextResponse } from 'next/server'
import { getCurrentAuth } from '@/lib/request-auth'

export async function GET() {
  try {
    const auth = await getCurrentAuth()
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({
      user: {
        id: auth.user.id,
        username: auth.user.username,
        role: auth.user.role,
        isActive: auth.user.isActive,
        lastLoginAt: auth.user.lastLoginAt,
        permissions: auth.permissions,
      },
    })
  } catch (error) {
    console.error('Session GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
