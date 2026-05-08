import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserId } from '@/lib/request-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId }
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ artifact })
  } catch (error) {
    console.error('[canvas/artifacts/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch artifact' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { name, content } = body

    const existing = await prisma.canvasArtifact.findFirst({
      where: { id, userId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const artifact = await prisma.canvasArtifact.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        content: content ?? existing.content,
        size: content ? Buffer.byteLength(content, 'utf8') : existing.size,
        version: existing.version + 1,
        updatedAt: new Date()
      }
    })

    return NextResponse.json({ artifact })
  } catch (error) {
    console.error('[canvas/artifacts/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update artifact' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId }
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.canvasArtifact.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[canvas/artifacts/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete artifact' }, { status: 500 })
  }
}
