import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { tagId } = body;

    // Verify session belongs to user
    const session = await prisma.chatSession.findFirst({
      where: { id, userId }
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Check if tag exists and belongs to user
    const tag = await prisma.tag.findFirst({
      where: { id: tagId, userId }
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Create session-tag relation (or ignore if already exists)
    const sessionTag = await prisma.chatSessionTag.upsert({
      where: {
        sessionId_tagId: {
          sessionId: id,
          tagId,
        }
      },
      create: {
        sessionId: id,
        tagId,
      },
      update: {},
    });

    return NextResponse.json({ success: true, sessionTag });
  } catch (error) {
    console.error('Add tag to session error:', error);
    return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const url = new URL(req.url);
    const tagId = url.searchParams.get('tagId');

    if (!tagId) {
      return NextResponse.json({ error: 'tagId is required' }, { status: 400 });
    }

    // Verify session belongs to user
    const session = await prisma.chatSession.findFirst({
      where: { id, userId }
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    await prisma.chatSessionTag.delete({
      where: {
        sessionId_tagId: {
          sessionId: id,
          tagId,
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove tag from session error:', error);
    return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 });
  }
}
