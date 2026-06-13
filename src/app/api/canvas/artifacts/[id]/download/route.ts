import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'

function sanitizeDownloadName(name: string): string {
  return (name.trim().split(/[\\/]/).pop() || 'artifact')
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .slice(0, 180)
}

function decodeArtifactContent(content: string, mimeType: string): Buffer {
  if (mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType === 'application/zip') {
    return Buffer.from(content.replace(/\s+/g, ''), 'base64')
  }
  return Buffer.from(content, 'utf8')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserIdWithPermission('canvas.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const artifact = await prisma.canvasArtifact.findFirst({
      where: { id, userId },
      select: {
        name: true,
        content: true,
        mimeType: true,
      },
    })

    if (!artifact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const bytes = decodeArtifactContent(artifact.content, artifact.mimeType)
    const filename = sanitizeDownloadName(artifact.name)

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': artifact.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    })
  } catch (error) {
    console.error('[canvas/artifacts/download] GET error:', error)
    return NextResponse.json({ error: 'Failed to download artifact' }, { status: 500 })
  }
}
