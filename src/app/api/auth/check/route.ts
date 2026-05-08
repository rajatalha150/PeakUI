import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const count = await prisma.user.count()
    return NextResponse.json({ isSetupNeeded: count === 0 })
  } catch (error) {
    console.error('Error checking setup status:', error)
    return NextResponse.json({ isSetupNeeded: false, error: 'Database connection failed' }, { status: 500 })
  }
}
