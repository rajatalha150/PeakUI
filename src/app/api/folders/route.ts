import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const folders = await prisma.folder.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
      include: {
        _count: {
          select: { sessions: true }
        }
      }
    });

    return NextResponse.json(folders);
  } catch (error) {
    console.error('Get folders error:', error);
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { name, color, order } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }

    const folder = await prisma.folder.create({
      data: {
        name: name.trim(),
        color: color || '#6366f1',
        order: order ?? 0,
        userId,
      }
    });

    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    console.error('Create folder error:', error);
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
