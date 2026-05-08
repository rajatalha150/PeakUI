import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserId } from '@/lib/request-auth'

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: { userId: string; sessionId?: string } = { userId }
    if (sessionId) where.sessionId = sessionId

    const artifacts = await prisma.canvasArtifact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        mimeType: true,
        kind: true,
        extension: true,
        size: true,
        sessionId: true,
        messageId: true,
        version: true,
        createdAt: true,
        updatedAt: true
      }
    })

    return NextResponse.json({ artifacts })
  } catch (error) {
    console.error('[canvas/artifacts] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch artifacts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, content, mimeType, kind, extension, sessionId, messageId } = body

    if (!name || !content || !sessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const artifact = await prisma.canvasArtifact.create({
      data: {
        name,
        content,
        mimeType: mimeType || 'text/plain',
        kind: kind || 'file',
        extension: extension || name.split('.').pop() || null,
        size: Buffer.byteLength(content, 'utf8'),
        sessionId,
        messageId: messageId || null,
        userId
      }
    })

    return NextResponse.json({ artifact }, { status: 201 })
  } catch (error) {
    console.error('[canvas/artifacts] POST error:', error)
    return NextResponse.json({ error: 'Failed to create artifact' }, { status: 500 })
  }
}
