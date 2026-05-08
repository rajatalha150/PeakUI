import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { prisma } from '@/lib/prisma';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { name, color, order } = body;

    const folder = await prisma.folder.findFirst({
      where: { id, userId }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    const updated = await prisma.folder.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(order !== undefined && { order }),
      }
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update folder error:', error);
    return NextResponse.json({ error: 'Failed to update folder' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    const folder = await prisma.folder.findFirst({
      where: { id, userId }
    });

    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    // Remove folder reference from sessions but don't delete them
    await prisma.chatSession.updateMany({
      where: { folderId: id },
      data: { folderId: null }
    });

    await prisma.folder.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete folder error:', error);
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 });
  }
}
